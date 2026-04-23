import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useSystemStatusStore } from '../store/systemStatusStore'
import { useHistoryStore } from '../store/historyStore'
import { useNotificationStore } from '../store/notificationStore'
import {
  Activity,
  Server,
  Database,
  Clock,
  HelpCircle,
  Play,
  Square,
  AlertTriangle,
  RotateCcw,
  Gauge,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import api from '../api/axios'

const PIPELINE_TOPICS = [
  'factory/line1/runtime/state',
  'factory/line1/runtime/cycle/features',
  'factory/line1/runtime/io_snapshot',
  'factory/line1/runtime/speed',
  'factory/line1/runtime/supervisor/heartbeat',
]

const dotClass = (kind) => {
  if (kind === 'green') return 'bg-green-500'
  if (kind === 'gray') return 'bg-gray-500'
  if (kind === 'yellow') return 'bg-yellow-400'
  return 'bg-red-500'
}

const SectionTitle = ({ icon: Icon, title, tooltip }) => (
  <CardTitle className="flex items-center gap-2 text-base">
    <Icon className="h-4 w-4 text-info" />
    <span>{title}</span>
    <span title={tooltip} className="text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" />
    </span>
  </CardTitle>
)

const internalScrollClass = 'overflow-y-auto [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground))_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50'

const Status = () => {
  const {
    wsConnected,
    wsLastMessage,
    currentDecisionLevel,
    currentMachineState,
    supervisorOnline,
    lastDecision,
    lastCycleFeatures,
    services, 
    mqttTopics,
  } = useSystemStatusStore()
  const { cycles, clearHistory } = useHistoryStore()
  const { success, error: notifyError } = useNotificationStore()
  const [messagesPerMinute, setMessagesPerMinute] = useState(0)
  const [events, setEvents] = useState([])
  const [resettingAnalytics, setResettingAnalytics] = useState(false)

  const machineState = (currentMachineState || 'WAITING').toUpperCase()
  const hasDecisionMessage = (mqttTopics['factory/line1/runtime/decision']?.messageCount || 0) > 0
  const hasInterpretationMessage = (mqttTopics['factory/line1/runtime/interpretation']?.messageCount || 0) > 0
  const hasCycleMessage = (mqttTopics['factory/line1/runtime/cycle/features']?.messageCount || 0) > 0
  const backendApiReachable = wsConnected || services.backend?.status === 'healthy'
  const mqttActive = wsConnected

  const isReady = supervisorOnline && wsConnected && backendApiReachable && mqttActive
  const readinessChecks = [
    { label: 'Machine State', state: machineState === 'WAITING' ? 'Waiting' : machineState, dot: machineState === 'WAITING' ? 'gray' : 'green' },
    { label: 'Supervisor', state: supervisorOnline ? 'Online' : 'Offline', dot: supervisorOnline ? 'green' : 'red' },
    { label: 'ML Engine', state: hasDecisionMessage ? 'Running' : 'Idle', dot: hasDecisionMessage ? 'green' : 'gray' },
    { label: 'Data Pipeline', state: hasCycleMessage ? 'Running' : 'Idle', dot: hasCycleMessage ? 'green' : 'gray' },
  ]

  const serviceRows = useMemo(() => {
    const backend = backendApiReachable ? { label: 'Online', dot: 'green' } : { label: 'Offline', dot: 'red' }
    const mqtt = mqttActive ? { label: 'Online', dot: 'green' } : { label: 'Offline', dot: 'red' }
    const websocket = wsConnected ? { label: 'Live', dot: 'green' } : { label: 'Offline', dot: 'red' }

    const ml = (() => {
      if (!hasDecisionMessage) return { label: 'Idle', dot: 'gray' }
      if (services.mlService?.status === 'degraded') return { label: 'Degraded', dot: 'yellow' }
      if (services.mlService?.status === 'unhealthy') return { label: 'Offline', dot: 'red' }
      return { label: 'Running', dot: 'green' }
    })()

    const chatgpt = (() => {
      if (!hasDecisionMessage && !hasInterpretationMessage) return { label: 'Idle', dot: 'gray' }
      if (services.chatgptService?.status === 'degraded') return { label: 'Degraded', dot: 'yellow' }
      if (services.chatgptService?.status === 'unhealthy') return { label: 'Offline', dot: 'red' }
      return { label: 'Running', dot: 'green' }
    })()

    const influx = backendApiReachable
      ? { label: 'Online', dot: 'green' }
      : { label: 'Offline', dot: 'red' }
    const supervisor = supervisorOnline ? { label: 'Online', dot: 'green' } : { label: 'Offline', dot: 'red' }

    return [
      { name: 'Backend API', ...backend },
      { name: 'MQTT Broker', ...mqtt },
      { name: 'WebSocket', ...websocket },
      { name: 'ML Service', ...ml },
      { name: 'ChatGPT Service', ...chatgpt },
      { name: 'InfluxDB', ...influx },
      { name: 'RevPi Supervisor', ...supervisor },
    ]
  }, [backendApiReachable, mqttActive, wsConnected, hasDecisionMessage, hasInterpretationMessage, services, supervisorOnline])

  const activityMetrics = useMemo(() => {
    const now = Date.now()
    const oneMinuteAgo = now - 60_000
    const cyclesPerMinute = (cycles || []).filter((c) => {
      const ts = new Date(c.timestamp).getTime()
      return Number.isFinite(ts) && ts >= oneMinuteAgo
    }).length
    const lastDuration = lastCycleFeatures?.cycle_duration ?? cycles[0]?.cycle_duration
    const lastAnomaly = lastDecision?.ml_result?.anomaly_score
    return [
      { label: 'Cycles / min', value: cyclesPerMinute },
      { label: 'Messages / min', value: Number(messagesPerMinute.toFixed(1)) },
      { label: 'Last cycle duration', value: lastDuration != null ? `${Number(lastDuration).toFixed(2)} s` : '-' },
      { label: 'Last anomaly score', value: lastAnomaly != null ? Number(lastAnomaly).toFixed(3) : '-' },
      { label: 'Last decision', value: currentDecisionLevel || lastDecision?.decision_level || '-' },
      { label: 'Last update time', value: wsLastMessage ? formatDistanceToNow(new Date(wsLastMessage), { addSuffix: true }) : 'Never' },
    ]
  }, [cycles, lastCycleFeatures, lastDecision, currentDecisionLevel, wsLastMessage, messagesPerMinute])

  const pipelineRows = useMemo(() => {
    const now = Date.now()
    const machineProducing = machineState === 'PRODUCING'
    return PIPELINE_TOPICS.map((topic) => {
      const activity = mqttTopics[topic]
      const lastTs = activity?.lastMessage ? new Date(activity.lastMessage).getTime() : null
      const ageSec = lastTs ? Math.max(0, (now - lastTs) / 1000) : null
      let dot = 'gray'
      let status = 'IDLE'
      if (topic === 'factory/line1/runtime/state' && wsConnected) {
        dot = 'green'
        status = 'ACTIVE'
      }
      if (ageSec != null && ageSec <= 10) {
        dot = 'green'
        status = 'ACTIVE'
      } else if (activity?.messageCount > 0 && machineProducing && ageSec != null && ageSec > 10) {
        dot = 'red'
        status = 'FAULT'
      }
      return {
        topic,
        count: activity?.messageCount || 0,
        lastMessage: activity?.lastMessage,
        dot,
        status,
      }
    })
  }, [mqttTopics, machineState, wsConnected])

  useEffect(() => {
    let cancelled = false
    const sampleMs = 2000
    let prevTs = Date.now()
    let prevCount = Object.values(mqttTopics || {}).reduce((sum, t) => sum + (t?.messageCount || 0), 0)

    const timer = setInterval(() => {
      const now = Date.now()
      const totalCount = Object.values(useSystemStatusStore.getState().mqttTopics || {})
        .reduce((sum, t) => sum + (t?.messageCount || 0), 0)
      const deltaCount = Math.max(0, totalCount - prevCount)
      const deltaMin = (now - prevTs) / 60000
      if (!cancelled && deltaMin > 0) {
        setMessagesPerMinute(deltaCount / deltaMin)
      }
      prevTs = now
      prevCount = totalCount
    }, sampleMs)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [mqttTopics])

  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get('/api/history/system-events')
      const rows = Array.isArray(res.data) ? res.data : []
      setEvents(rows)
    } catch {
      setEvents([])
    }
  }, [])

  useEffect(() => {
    loadEvents()
    const timer = setInterval(loadEvents, 15000)
    return () => {
      clearInterval(timer)
    }
  }, [loadEvents])

  const handleResetAnalytics = useCallback(async () => {
    setResettingAnalytics(true)
    try {
      await api.post('/api/dev/reset-analytics')
      success('Analytics data cleared successfully.')
      clearHistory()
      await loadEvents()
      window.dispatchEvent(new Event('dashboard-refresh'))
    } catch (err) {
      notifyError(err?.response?.data?.detail || 'Failed to reset analytics data.')
    } finally {
      setResettingAnalytics(false)
    }
  }, [clearHistory, loadEvents, notifyError, success])

  const combinedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 15),
    [events]
  )

  const getEventVisual = (event) => {
    const eventType = String(event?.event_type || '').toUpperCase()
    const description = String(event?.description || '').toUpperCase()
    const severity = String(event?.severity || '').toLowerCase()

    if (eventType === 'START_PRODUCTION' || eventType === 'PRODUCING' || description.includes('PRODUCTION STARTED')) {
      return {
        icon: <Play size={16} className="text-green-500 mr-2" />,
        dot: 'bg-green-500',
      }
    }
    if (eventType === 'STOP_PRODUCTION' || eventType === 'STOPPED' || eventType === 'STOPPING' || description.includes('MACHINE STOPPED')) {
      return {
        icon: <Square size={16} className="text-orange-500 mr-2" />,
        dot: 'bg-orange-500',
      }
    }
    if (eventType === 'EMERGENCY_STOP' || description.includes('EMERGENCY STOP')) {
      return {
        icon: <AlertTriangle size={16} className="text-red-500 mr-2" />,
        dot: 'bg-red-500',
      }
    }
    if (eventType === 'RESET_SYSTEM' || description.includes('SYSTEM RESET')) {
      return {
        icon: <RotateCcw size={16} className="text-blue-500 mr-2" />,
        dot: 'bg-blue-500',
      }
    }
    if (eventType === 'SET_SPEED' || description.includes('SPEED CHANGED') || description.includes('SPEED INITIALIZED')) {
      return {
        icon: <Gauge size={16} className="text-blue-500 mr-2" />,
        dot: 'bg-blue-500',
      }
    }
    if (eventType === 'BOOTING' || description.includes('CONNECTED TO RUNTIME')) {
      return {
        icon: <Activity size={16} className="text-blue-500 mr-2" />,
        dot: 'bg-blue-500',
      }
    }
    if (severity === 'critical') {
      return {
        icon: <AlertTriangle size={16} className="text-red-500 mr-2" />,
        dot: 'bg-red-500',
      }
    }
    if (severity === 'warning') {
      return {
        icon: <AlertTriangle size={16} className="text-yellow-500 mr-2" />,
        dot: 'bg-yellow-400',
      }
    }
    return {
      icon: <Clock size={16} className="text-muted-foreground mr-2" />,
      dot: 'bg-gray-500',
    }
  }

  return (
    <div className="min-h-screen flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            System Health Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            Full system readiness and data pipeline overview
          </p>
        </div>
        <Badge variant={isReady ? 'normal' : 'emergency'}>
          {isReady ? 'READY' : 'NOT READY'}
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Development Tools</CardTitle>
          <CardDescription>Utilities for development and analytics testing.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={handleResetAnalytics}
            disabled={resettingAnalytics}
          >
            {resettingAnalytics ? 'Resetting...' : 'Reset Analytics Data'}
          </Button>
        </CardContent>
      </Card>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 grid-rows-[auto_auto_minmax(0,1fr)] gap-4">
        <Card className="min-h-0 flex flex-col h-full">
          <CardHeader className="pb-2">
            <SectionTitle
              icon={Activity}
              title="System Readiness"
              tooltip="Overall readiness based on supervisor, websocket, latest decision, and latest cycle features."
            />
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto pr-2 space-y-3">
            <div className={`rounded-lg border p-3 text-center ${isReady ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              <p className={`text-xl font-bold ${isReady ? 'text-green-600' : 'text-red-600'}`}>
                {isReady ? 'SYSTEM READY' : 'SYSTEM NOT READY'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {readinessChecks.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{item.state}</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${dotClass(item.dot)}`} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-0 flex flex-col h-full">
          <CardHeader className="pb-2">
            <SectionTitle
              icon={Server}
              title="Service Health"
              tooltip="Live health summary of core runtime services."
            />
          </CardHeader>
          <CardContent className={`min-h-0 flex-1 pr-2 space-y-2 ${internalScrollClass}`}>
            {serviceRows.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{item.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${dotClass(item.dot)}`} />
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 min-h-0 flex flex-col h-full max-h-[140px]">
          <CardHeader className="pb-2">
            <SectionTitle
              icon={Activity}
              title="System Activity"
              tooltip="Real-time operational metrics derived from websocket and stores."
            />
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto pr-2 pt-0">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {activityMetrics.map((metric) => (
                <div key={metric.label} className="rounded-md border px-2 py-1.5 bg-muted/20">
                  <p className="text-[10px] text-muted-foreground leading-tight">{metric.label}</p>
                  <p className="text-base font-semibold mt-0.5 truncate leading-tight">{metric.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[340px] flex flex-col h-full">
          <CardHeader className="pb-2">
            <SectionTitle
              icon={Database}
              title="Real-Time Telemetry Streams"
              tooltip="Topic activity monitor. Streams older than 10 seconds are marked as inactive."
            />
            <CardDescription>Inactive streams (&gt;10s) are highlighted.</CardDescription>
          </CardHeader>
          <CardContent className={`min-h-0 flex-1 pr-2 space-y-2 ${internalScrollClass}`}>
            {pipelineRows.map((row) => (
              <div key={row.topic} className="rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs truncate">{row.topic}</p>
                  <span className={`h-2.5 w-2.5 rounded-full ${dotClass(row.dot)}`} />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Messages: {row.count}</span>
                  <span>
                    {row.lastMessage
                      ? formatDistanceToNow(new Date(row.lastMessage), { addSuffix: true })
                      : 'No data'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Status: {row.status}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="min-h-[340px] flex flex-col h-full">
          <CardHeader className="pb-2">
            <SectionTitle
              icon={Clock}
              title="Recent System Events"
              tooltip="Recent transitions and control events, including stop classifications when available."
            />
          </CardHeader>
          <CardContent className={`min-h-0 flex-1 space-y-2 pr-2 ${internalScrollClass}`}>
            {combinedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent events available.</p>
            ) : (
              combinedEvents.map((event, idx) => (
                <div key={`${event.timestamp}-${idx}`} className="rounded-md border p-2.5">
                  {(() => {
                    const visual = getEventVisual(event)
                    return (
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${visual.dot}`} />
                    <span className="flex items-center justify-center">
                      {visual.icon}
                    </span>
                    <span className="text-xs text-muted-foreground min-w-[40px]">
                      {event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                    <p className="text-sm font-medium">{event.description || event.event_type || 'System event'}</p>
                  </div>
                    )
                  })()}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Status
