import { useEffect, useState } from 'react'
import { useSystemStatusStore } from '../store/systemStatusStore'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import MachineDiagram from '../components/MachineDiagram.jsx'
import ProductionTimeline from '../components/ProductionTimeline'
import CyclePerformanceCard from '../components/CyclePerformanceCard'
import TimelineLegend from '../components/TimelineLegend'
import api from '../api/axios'
import { Gauge } from 'lucide-react'

const Dashboard = () => {
  const {
    currentDecisionLevel,
    currentMachineState,
    lastDecision,
    lastCycleFeatures,
    liveIo,
    livePwms,
    currentMachineSpeed,
    services,
    mqttTopics,
    wsConnected,
    supervisorOnline,
  } = useSystemStatusStore()
  const [focusedSubsystem, setFocusedSubsystem] = useState(null)
  const [activityEvents, setActivityEvents] = useState([])
  const hasDecisionMessage = (mqttTopics['factory/line1/runtime/decision']?.messageCount || 0) > 0
  const hasInterpretationMessage = (mqttTopics['factory/line1/runtime/interpretation']?.messageCount || 0) > 0

  const speedMode = (() => {
    const pwm = Number(currentMachineSpeed)
    if (pwm === 70) return 'Reduced'
    if (pwm === 80) return 'Nominal'
    if (pwm === 90) return 'High'
    if (pwm === 100) return 'Maximum'
    return currentMachineSpeed != null ? 'Custom' : 'Unknown'
  })()

  const getDecisionLevelColor = (level) => {
    const colors = {
      NORMAL: 'normal',
      WARNING: 'warning',
      CRITICAL: 'critical',
      EMERGENCY_STOP: 'emergency',
    }
    return colors[level] || 'default'
  }

  const machineRuntimeState = (currentMachineState || 'WAITING').toUpperCase()
  const diagramIo = liveIo ?? lastCycleFeatures?.io
  const diagramPwms = livePwms ?? lastCycleFeatures?.pwms
  const diagramLastUpdate = lastCycleFeatures?.timestamp || lastDecision?.timestamp
  const diagramDecisionLevel = (
    machineRuntimeState === 'IDLE' ||
    machineRuntimeState === 'WAITING' ||
    machineRuntimeState === 'DISCONNECTED'
  ) ? null : currentDecisionLevel

  const serviceRows = [
    {
      name: 'MQTT Broker',
      state: wsConnected ? 'Running' : 'Offline',
      dot: wsConnected ? 'bg-green-500' : 'bg-red-500',
    },
    {
      name: 'Backend API',
      state: wsConnected || services.backend?.status === 'healthy' ? 'Running' : 'Offline',
      dot: wsConnected || services.backend?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500',
    },
    {
      name: 'ML Service',
      state: !hasDecisionMessage
        ? 'Idle'
        : services.mlService?.status === 'degraded'
          ? 'Degraded'
          : services.mlService?.status === 'unhealthy'
            ? 'Offline'
            : 'Running',
      dot: !hasDecisionMessage
        ? 'bg-gray-500'
        : services.mlService?.status === 'degraded'
          ? 'bg-yellow-400'
          : services.mlService?.status === 'unhealthy'
            ? 'bg-red-500'
            : 'bg-green-500',
    },
    {
      name: 'ChatGPT Service',
      state: (!hasDecisionMessage && !hasInterpretationMessage)
        ? 'Idle'
        : services.chatgptService?.status === 'degraded'
          ? 'Degraded'
          : services.chatgptService?.status === 'unhealthy'
            ? 'Offline'
            : 'Running',
      dot: (!hasDecisionMessage && !hasInterpretationMessage)
        ? 'bg-gray-500'
        : services.chatgptService?.status === 'degraded'
          ? 'bg-yellow-400'
          : services.chatgptService?.status === 'unhealthy'
            ? 'bg-red-500'
            : 'bg-green-500',
    },
    {
      name: 'RevPi Supervisor',
      state: supervisorOnline ? 'Running' : 'Offline',
      dot: supervisorOnline ? 'bg-green-500' : 'bg-red-500',
    },
    {
      name: 'WebSocket',
      state: wsConnected ? 'Running' : 'Offline',
      dot: wsConnected ? 'bg-green-500' : 'bg-red-500',
    },
  ]

  useEffect(() => {
    let active = true

    const loadActivity = async () => {
      try {
        const [cyclesRes, incidentsRes] = await Promise.all([
          api.get('/api/history/cycles'),
          api.get('/api/history/incidents'),
        ])

        const cycleRows = (Array.isArray(cyclesRes.data) ? cyclesRes.data : []).map((cycle) => ({
          timestamp: cycle?.timestamp,
          text: `Cycle ${cycle?.global_cycle_id ?? cycle?.cycle_id ?? 'N/A'} completed`,
          color: 'bg-blue-500',
        }))

        const incidentRows = (Array.isArray(incidentsRes.data) ? incidentsRes.data : [])
          .filter((incident) => {
            const decision = String(incident?.decision || '').toUpperCase()
            return decision === 'WARNING' || decision === 'CRITICAL' || decision === 'EMERGENCY' || decision === 'EMERGENCY_STOP'
          })
          .map((incident) => {
            const decision = String(incident?.decision || '').toUpperCase()
            const label = decision === 'EMERGENCY_STOP' ? 'EMERGENCY' : decision
          let color = 'bg-yellow-400'
          if (decision === 'CRITICAL') color = 'bg-orange-500'
          if (decision === 'EMERGENCY' || decision === 'EMERGENCY_STOP') color = 'bg-red-500'
          return {
            timestamp: incident?.timestamp,
            text: `${label} anomaly detected (Cycle ${incident?.global_cycle_id ?? incident?.cycle_id ?? 'N/A'})`,
            color,
          }
        })

        const merged = [...cycleRows, ...incidentRows]
          .filter((item) => item?.timestamp)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 10)

        if (active) setActivityEvents(merged)
      } catch {
        if (active) setActivityEvents([])
      }
    }

    loadActivity()
    const timer = setInterval(loadActivity, 10000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="min-h-full flex flex-col gap-4">
      <ProductionTimeline />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-1 min-h-0">
          <div className="grid grid-cols-1 gap-4 h-full">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Service Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {serviceRows.map((row) => (
                  <div key={row.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${row.dot}`} />
                      <span>{row.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{row.state}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="min-h-0 flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Recent Production Activity</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
                {activityEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent activity.</p>
                ) : (
                  activityEvents.map((event, idx) => (
                    <div key={`${event.timestamp}-${idx}`} className="rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${event.color}`} />
                        <span className="text-xs text-muted-foreground min-w-[58px]">
                          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="text-sm">{event.text}</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="xl:col-span-2">
          <Card className="h-full min-h-[720px] flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">Machine Visualization</CardTitle>
                <Badge variant={getDecisionLevelColor(currentDecisionLevel)}>
                  {currentDecisionLevel || 'Waiting for production start'}
                </Badge>
              </div>
              {!lastCycleFeatures && (
                <p className="text-xs text-muted-foreground">
                  Start production to visualize machine activity.
                </p>
              )}
            </CardHeader>
            <CardContent className="flex-1">
              <div className="h-[600px] w-full">
                <MachineDiagram
                  io={diagramIo}
                  pwms={diagramPwms}
                  decisionLevel={diagramDecisionLevel}
                  machineState={machineRuntimeState}
                  lastUpdate={diagramLastUpdate}
                  focusedSubsystem={focusedSubsystem}
                  onSubsystemSelect={setFocusedSubsystem}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-1 min-h-0">
          <CyclePerformanceCard />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="h-5 w-5 text-info" />
            Machine Speed
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border p-3 bg-muted/20">
            <p className="text-xs text-muted-foreground">Current Mode</p>
            <p className="text-lg font-semibold mt-1">{speedMode}</p>
          </div>
          <div className="rounded-md border p-3 bg-muted/20">
            <p className="text-xs text-muted-foreground">PWM Value</p>
            <p className="text-lg font-semibold mt-1">
              {currentMachineSpeed != null ? `${Number(currentMachineSpeed)} %` : 'N/A'}
            </p>
          </div>
        </CardContent>
      </Card>

      <TimelineLegend />
    </div>
  )
}

export default Dashboard
