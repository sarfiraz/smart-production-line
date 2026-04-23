import { useEffect, useRef } from 'react'
import { useSystemStatusStore } from '../store/systemStatusStore'
import { useHistoryStore } from '../store/historyStore'
import { useNotificationStore } from '../store/notificationStore'

// Singleton WebSocket manager
class WebSocketManager {
  constructor() {
    this.ws = null
    this.reconnectTimeout = null
    this.reconnectAttempts = 0
    this.listeners = new Set()
    this.isConnecting = false
  }

  subscribe(callback) {
    this.listeners.add(callback)
    // If already connected, notify immediately
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      callback({ type: 'status', connected: true })
    }
    return () => this.listeners.delete(callback)
  }

  notifyListeners(event) {
    this.listeners.forEach(callback => callback(event))
  }

  connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return
    }

    this.isConnecting = true
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/live'
    
    try {
      // Close existing connection if any
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close()
      }
      
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('WebSocket connected')
        this.isConnecting = false
        this.reconnectAttempts = 0
        this.notifyListeners({ type: 'status', connected: true })
        this.notifyListeners({ type: 'message', timestamp: new Date().toISOString() })
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.notifyListeners({ type: 'message', data: message, timestamp: new Date().toISOString() })
        } catch (err) {
          console.error('Error parsing WebSocket message:', err)
        }
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        this.isConnecting = false
        this.notifyListeners({ type: 'status', connected: false })
      }

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason)
        this.isConnecting = false
        this.notifyListeners({ type: 'status', connected: false })
        
        // Only reconnect if:
        // 1. It wasn't a manual close (code 1000)
        // 2. We haven't exceeded attempts
        // 3. There are still listeners (components using the connection)
        if (event.code !== 1000 && this.reconnectAttempts < 5 && this.listeners.size > 0) {
          this.reconnectAttempts++
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
          this.reconnectTimeout = setTimeout(() => {
            // Double-check listeners before reconnecting
            if (this.listeners.size > 0) {
              this.connect()
            }
          }, delay)
        } else if (this.reconnectAttempts >= 5) {
          this.notifyListeners({ type: 'error', message: 'WebSocket connection failed after multiple attempts' })
        }
      }
    } catch (err) {
      console.error('WebSocket connection error:', err)
      this.isConnecting = false
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      // Remove event handlers to prevent callbacks
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      const oldOnClose = this.ws.onclose
      this.ws.onclose = null
      
      // Only close if not already closed
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Disconnecting')
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        // If still connecting, don't close immediately - let it finish or timeout
        // This prevents "closed before connection established" errors
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            // Still connecting after delay, safe to close now
            this.ws.close(1000, 'Disconnecting')
          }
        }, 500)
      }
      this.ws = null
    }
    this.isConnecting = false
  }
}

// Global singleton instance
const wsManager = new WebSocketManager()

// Expose to window for logout cleanup (optional, for debugging)
if (typeof window !== 'undefined') {
  window.wsManager = wsManager
}

export function useWebSocket() {
  const {
    setWsConnected,
    setWsLastMessage,
    setDecisionLevel,
    setLastDecision,
    setCurrentMachineState,
    setCurrentMachineSpeed,
    setSupervisorOnline,
    setLastCycleFeatures,
    setLiveSnapshot,
    updateMqttTopic,
    updateServiceStatus,
  } = useSystemStatusStore()
  const { warning, error: notifyError } = useNotificationStore()
  const { addDecision, addCycle, addInterpretation } = useHistoryStore()
  const callbackRef = useRef(null)

  useEffect(() => {
    // Create callback that updates store
    callbackRef.current = (event) => {
      if (event.type === 'status') {
        setWsConnected(event.connected)
        // WebSocket connection status indicates backend health
        if (updateServiceStatus) {
          updateServiceStatus('backend', event.connected ? 'healthy' : 'unhealthy')
        }
      } else if (event.type === 'message') {
        if (event.timestamp) {
          setWsLastMessage(event.timestamp)
        }
        if (event.data) {
          const message = event.data
          // Handle messages by topic (backend sends topic in message)
          const topic = message.topic
          
          if (topic) {
            // Update MQTT topic activity tracking
            updateMqttTopic(topic)
            
            // Decision messages
            if (topic === 'factory/line1/runtime/decision') {
              const decisionData = message.data || message
              if (decisionData?.decision_level) {
                setDecisionLevel(decisionData.decision_level)
                setLastDecision(decisionData)
                // Add to history
                addDecision(decisionData)
                // Decision messages indicate decision engine is healthy
                if (updateServiceStatus) {
                  updateServiceStatus('decisionEngine', 'healthy')
                }
              }
            }
            
            // Cycle features messages (contains io and pwms)
            if (topic === 'factory/line1/runtime/cycle/features') {
              const featuresData = message.data || message
              // Deterministic rule: update live features during production.
              // While stopped/stopping, keep last known snapshot frozen.
              const machineStateNow = (useSystemStatusStore.getState().currentMachineState || 'WAITING').toUpperCase()
              const hasNoSnapshotYet = !useSystemStatusStore.getState().lastCycleFeatures
              if (machineStateNow === 'PRODUCING' || hasNoSnapshotYet) {
                setLastCycleFeatures(featuresData)
                // Add to history only when accepted into live state
                addCycle(featuresData)
              }
            }

            if (topic === 'factory/line1/runtime/io_snapshot') {
              const snapshotData = message.data || message
              setLiveSnapshot(snapshotData?.io, snapshotData?.pwms)
            }

            // Machine state messages
            if (topic === 'factory/line1/runtime/state') {
              const stateData = message.data || message
              const nextState = (stateData?.state || 'WAITING').toUpperCase()
              setCurrentMachineState(nextState)
            }

            if (topic === 'factory/line1/runtime/speed') {
              const speedData = message.data || message
              const pwm = speedData?.pwm
              if (pwm != null) {
                console.log('Machine speed update:', pwm)
                const speed = Number(pwm)
                if (Number.isFinite(speed)) {
                  setCurrentMachineSpeed(speed)
                }
              }
            }

            if (topic === 'factory/line1/runtime/supervisor/status') {
              const supervisorData = message.data || message
              setSupervisorOnline(!!supervisorData?.online)
            }
            
            // Interpretation messages
            if (topic === 'factory/line1/runtime/interpretation') {
              const interpretationData = message.data || message
              addInterpretation(interpretationData)
              // Receiving interpretation output confirms the AI service is running
              if (updateServiceStatus) {
                updateServiceStatus('chatgptService', 'healthy')
              }
            }
            
            // IO Health messages
            if (topic === 'factory/line1/runtime/io_health') {
              // IO health data can be used for status updates
              const ioHealthData = message.data || message
              // IO health messages indicate ML service is healthy
              if (updateServiceStatus) {
                updateServiceStatus('mlService', 'healthy')
              }
            }
            
            // ML Behavior messages (formerly ml_result)
            if (topic === 'factory/line1/runtime/ml_behavior') {
              // ML behavior data can be used for status updates
              const mlBehaviorData = message.data || message
              // ML behavior messages indicate ML service is healthy
              if (updateServiceStatus) {
                updateServiceStatus('mlService', 'healthy')
              }
            }
            
            // Status messages from services
            if (topic === 'factory/line1/runtime/status') {
              const statusData = message.data || message
              const statusMessage = statusData.message || ''
              const statusLevel = statusData.level || 'INFO'
              
              // Determine service name from message content
              let serviceName = null
              if (statusMessage.includes('ML service')) {
                serviceName = 'mlService'
              } else if (statusMessage.includes('ChatGPT') || statusMessage.includes('chatgpt')) {
                serviceName = 'chatgptService'
              } else if (statusMessage.includes('Decision') || statusMessage.includes('decision')) {
                serviceName = 'decisionEngine'
              } else if (statusMessage.includes('backend') || statusMessage.includes('Backend')) {
                serviceName = 'backend'
              }
              
              // Update service status based on level
              if (serviceName && updateServiceStatus) {
                let healthStatus = 'unknown'
                if (statusLevel === 'ERROR') {
                  healthStatus = 'unhealthy'
                } else if (statusLevel === 'WARNING') {
                  healthStatus = 'degraded'
                } else if (statusLevel === 'INFO') {
                  healthStatus = 'healthy'
                }
                updateServiceStatus(serviceName, healthStatus)
              }
            }
          }
        }
      }
    }

    // Subscribe to WebSocket events
    const unsubscribe = wsManager.subscribe(callbackRef.current)
    
    // Connect if not already connected
    wsManager.connect()

    return () => {
      unsubscribe()
      // Don't disconnect on component unmount - let WebSocket persist across route changes
      // Only disconnect will happen on actual logout or app unmount
      // This prevents React StrictMode from closing the connection
    }
  }, [
    setWsConnected,
    setWsLastMessage,
    setDecisionLevel,
    setLastDecision,
    setCurrentMachineState,
    setCurrentMachineSpeed,
    setSupervisorOnline,
    setLastCycleFeatures,
    setLiveSnapshot,
    updateMqttTopic,
    updateServiceStatus,
    addDecision,
    addCycle,
    addInterpretation,
  ])
}
