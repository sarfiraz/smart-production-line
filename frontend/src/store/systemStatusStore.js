import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const systemStatusStore = create(persist((set) => ({
  // WebSocket connection status
  wsConnected: false,
  wsLastMessage: null,
  wsReconnectAttempts: 0,
  
  // Current decision level
  currentDecisionLevel: null,
  lastDecision: null,
  currentMachineState: 'WAITING',
  currentMachineSpeed: 80,
  supervisorOnline: false,
  
  // Latest cycle features (io and pwms)
  lastCycleFeatures: null,
  liveIo: null,
  livePwms: null,
  
  // Service health (mock for now, can be connected to real endpoints later)
  services: {
    mlService: { status: 'idle', lastUpdate: null },
    decisionEngine: { status: 'idle', lastUpdate: null },
    chatgptService: { status: 'idle', lastUpdate: null },
    backend: { status: 'idle', lastUpdate: null },
  },
  
  // MQTT topic activity
  mqttTopics: {
    'factory/line1/runtime/decision': { lastMessage: null, messageCount: 0 },
    'factory/line1/runtime/interpretation': { lastMessage: null, messageCount: 0 },
    'factory/line1/runtime/io_health': { lastMessage: null, messageCount: 0 },
    'factory/line1/runtime/ml_behavior': { lastMessage: null, messageCount: 0 },
    'factory/line1/runtime/cycle/features': { lastMessage: null, messageCount: 0 },
    'factory/line1/runtime/status': { lastMessage: null, messageCount: 0 },
  },
  
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setWsLastMessage: (timestamp) => set({ wsLastMessage: timestamp }),
  setWsReconnectAttempts: (attempts) => set({ wsReconnectAttempts: attempts }),
  
  setDecisionLevel: (level) => set({ currentDecisionLevel: level }),
  setLastDecision: (decision) => set({ lastDecision: decision }),
  setCurrentMachineState: (state) => set({ currentMachineState: state }),
  setCurrentMachineSpeed: (speed) => set({ currentMachineSpeed: speed }),
  setSupervisorOnline: (online) => set({ supervisorOnline: !!online }),
  setLastCycleFeatures: (features) => set({ lastCycleFeatures: features }),
  setLiveSnapshot: (io, pwms) => set({ liveIo: io, livePwms: pwms }),
  
  updateServiceStatus: (serviceName, status) => {
    set((state) => ({
      services: {
        ...state.services,
        [serviceName]: {
          status,
          lastUpdate: new Date().toISOString(),
        },
      },
    }))
  },
  
  updateMqttTopic: (topic) => {
    set((state) => ({
      mqttTopics: {
        ...state.mqttTopics,
        [topic]: {
          lastMessage: new Date().toISOString(),
          messageCount: (state.mqttTopics[topic]?.messageCount || 0) + 1,
        },
      },
    }))
  },
}), {
  name: 'system-status-store',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    currentMachineSpeed: state.currentMachineSpeed,
  }),
}))

export const useSystemStatusStore = systemStatusStore

