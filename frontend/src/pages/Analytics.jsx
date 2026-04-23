import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, ComposedChart, Scatter, ScatterChart, Legend,
} from 'recharts'
import { TrendingUp, BarChart3, Clock, Percent, RefreshCw, HelpCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select'
import api from '../api/axios'

const STATUS_COLORS = {
  NORMAL: '#10b981',
  WARNING: '#facc15',
  CRITICAL: '#f97316',
  EMERGENCY_STOP: '#ef4444',
  UNKNOWN: '#6b7280',
}

const INCIDENT_COLORS = {
  WARNING: '#facc15',
  CRITICAL: '#f97316',
  EMERGENCY: '#ef4444',
  EMERGENCY_STOP: '#ef4444',
}

const DECISION_TO_LEVEL = {
  NORMAL: 0,
  WARNING: 1,
  CRITICAL: 2,
  EMERGENCY: 3,
  EMERGENCY_STOP: 3,
}

const STATE_COLORS = {
  IDLE: '#6b7280',
  PRODUCING: '#10b981',
  STOPPING: '#facc15',
  STOPPED: '#6b7280',
  EMERGENCY_STOP: '#ef4444',
  UNKNOWN: '#9ca3af',
}

const RANGE_OPTIONS = {
  TODAY: { label: 'Today' },
  '24H': { label: 'Last 24 Hours' },
  '7D': { label: 'Last 7 Days' },
  '30D': { label: 'Last 30 Days' },
}
const EMPTY_WINDOW_MESSAGE = 'No data available for selected time window'

const TitleWithHelp = ({ icon: Icon, title, tooltip }) => (
  <CardTitle className="flex items-center gap-2 text-base">
    <Icon className="h-5 w-5 text-info" />
    <span>{title}</span>
    <span
      title={tooltip}
      className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
      aria-label={`${title} info`}
    >
      <HelpCircle className="h-4 w-4" />
    </span>
  </CardTitle>
)

const Analytics = () => {
  const [range, setRange] = useState('TODAY')
  const [anomalyTrend, setAnomalyTrend] = useState([])
  const [cyclesData, setCyclesData] = useState([])
  const [incidentsData, setIncidentsData] = useState([])
  const [stateTransitions, setStateTransitions] = useState([])
  const [systemEvents, setSystemEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const getTimestamp = useCallback((row) => {
    const raw = row?.timestamp ?? row?.ts ?? row?.time ?? row?.created_at ?? null
    const ts = raw ? new Date(raw).getTime() : NaN
    return Number.isFinite(ts) ? ts : null
  }, [])

  const backendRange = useMemo(() => {
    if (range === 'TODAY') return 'today'
    if (range === '7D') return '7d'
    if (range === '30D') return '30d'
    return '24h'
  }, [range])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [anomalyRes, cyclesRes, incidentsRes, stateRes, systemEventsRes] = await Promise.all([
        api.get('/api/history/anomaly-trend', { params: { range: backendRange } }),
        api.get('/api/history/cycles', { params: { range: backendRange } }),
        api.get('/api/history/incidents', { params: { range: backendRange } }),
        api.get('/api/history/state-transitions', { params: { range: backendRange } }),
        api.get('/api/history/system-events'),
      ])
      setAnomalyTrend(anomalyRes.data)
      const allCycles = Array.isArray(cyclesRes.data) ? cyclesRes.data : []
      setCyclesData(allCycles)
      setIncidentsData(Array.isArray(incidentsRes.data) ? incidentsRes.data : [])
      setStateTransitions(Array.isArray(stateRes.data) ? stateRes.data : [])
      setSystemEvents(Array.isArray(systemEventsRes.data) ? systemEventsRes.data : [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load analytics data')
    } finally {
      setLoading(false)
    }
  }, [backendRange])

  useEffect(() => { fetchAll() }, [fetchAll])

  const timeWindow = useMemo(() => {
    const now = Date.now()
    let startTime

    switch (range) {
      case 'TODAY': {
        const start = new Date()
        start.setUTCHours(0, 0, 0, 0)
        startTime = start.getTime()
        break
      }
      case '24H':
        startTime = now - (24 * 60 * 60 * 1000)
        break
      case '30D':
        startTime = now - (30 * 24 * 60 * 60 * 1000)
        break
      case '7D':
      default:
        startTime = now - (7 * 24 * 60 * 60 * 1000)
        break
    }

    return {
      now,
      startTime,
      windowMs: Math.max(0, now - startTime),
    }
  }, [range])

  const normalizedIncidents = useMemo(() => (
    (incidentsData || [])
      .map((incident) => {
        const timestamp = getTimestamp(incident)
        if (timestamp == null) return null
        const decision = String(incident?.decision || incident?.severity || 'UNKNOWN').toUpperCase()
        return {
          timestamp,
          global_cycle_id: Number(incident?.global_cycle_id),
          cycle_id: Number(incident?.cycle_id),
          cycle_key: Number(incident?.global_cycle_id ?? incident?.cycle_id),
          decision,
          severity: String(incident?.severity || decision || 'UNKNOWN').toUpperCase(),
          reason: incident?.reason || incident?.description || '',
        }
      })
      .filter(Boolean)
  ), [getTimestamp, incidentsData])

  const normalizedCycles = useMemo(() => {
    const incidentDecisionByCycleId = normalizedIncidents.reduce((acc, incident) => {
      if (Number.isFinite(incident.cycle_key)) acc[incident.cycle_key] = incident.decision
      return acc
    }, {})

    return (cyclesData || [])
      .map((cycle, idx) => {
        const timestamp = getTimestamp(cycle)
        if (timestamp == null) return null
        const cycleId = Number(cycle?.cycle_id ?? cycle?.id ?? idx + 1)
        const globalCycleId = Number(cycle?.global_cycle_id ?? cycle?.cycle_id ?? cycle?.id ?? idx + 1)
        const duration = Number(cycle?.cycle_duration)
        const speed = Number(cycle?.speed)
        if (!Number.isFinite(duration) || !Number.isFinite(speed)) return null
        const rawDecision = String(cycle?.decision || '').toUpperCase()
        const decision = rawDecision || incidentDecisionByCycleId[globalCycleId] || 'NORMAL'
        return {
          timestamp,
          cycle_id: cycleId,
          global_cycle_id: globalCycleId,
          duration,
          speed,
          decision,
        }
      })
      .filter(Boolean)
  }, [cyclesData, getTimestamp, normalizedIncidents])

  const normalizedStateTransitions = useMemo(() => (
    (Array.isArray(stateTransitions) ? stateTransitions : [])
      .map((item) => {
        const timestamp = getTimestamp(item)
        if (timestamp == null) return null
        return {
          timestamp,
          state: String(item?.state || 'UNKNOWN').toUpperCase(),
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)
  ), [getTimestamp, stateTransitions])

  const normalizedSpeedEvents = useMemo(() => (
    normalizedCycles.map((cycle) => ({
      timestamp: cycle.timestamp,
      speed: cycle.speed,
      duration: cycle.duration,
      cycle_id: cycle.global_cycle_id ?? cycle.cycle_id,
    }))
  ), [normalizedCycles])

  const normalizedSystemEvents = useMemo(() => (
    (systemEvents || [])
      .map((event) => {
        const timestamp = getTimestamp(event)
        if (timestamp == null) return null
        return {
          timestamp,
          severity: String(event?.severity || 'UNKNOWN').toUpperCase(),
        }
      })
      .filter(Boolean)
  ), [getTimestamp, systemEvents])

  const filteredCycles = useMemo(() => (
    normalizedCycles
  ), [normalizedCycles])

  const filteredStateTransitions = useMemo(() => (
    normalizedStateTransitions
  ), [normalizedStateTransitions])

  const filteredIncidents = useMemo(() => (
    normalizedIncidents
  ), [normalizedIncidents])

  const filteredSpeedEvents = useMemo(() => (
    normalizedSpeedEvents
  ), [normalizedSpeedEvents])

  const filteredSystemEvents = useMemo(() => (
    normalizedSystemEvents
  ), [normalizedSystemEvents])

  const decisionChartData = useMemo(() => {
    const byDecision = filteredCycles.reduce((acc, cycle) => {
      const key = String(cycle?.decision || 'UNKNOWN').toUpperCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return ['NORMAL', 'WARNING', 'CRITICAL', 'EMERGENCY_STOP'].map((key) => ({
      name: key,
      count: byDecision[key] || 0,
      fill: STATUS_COLORS[key] || STATUS_COLORS.UNKNOWN,
    }))
  }, [filteredCycles])

  const stateChartData = useMemo(() => {
    const counts = filteredStateTransitions.reduce((acc, item) => {
      const state = String(item?.state || 'UNKNOWN').toUpperCase()
      acc[state] = (acc[state] || 0) + 1
      return acc
    }, {})

    return ['IDLE', 'PRODUCING', 'STOPPING', 'STOPPED', 'EMERGENCY_STOP'].map((key) => ({
      name: key,
      count: Number(counts[key] || 0),
      fill: STATE_COLORS[key] || STATE_COLORS.UNKNOWN,
    }))
  }, [filteredStateTransitions])

  const anomalyChartData = useMemo(() => {
    return (anomalyTrend || [])
      .map((p) => ({
        ...p,
        timeLabel: new Date(p.timestamp || p.time || p.ts).toLocaleString([], {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }))
  }, [anomalyTrend])

  const cycleChartData = useMemo(() => {
    return filteredCycles.map((cycle) => ({
      cycle_duration: cycle.duration,
      timeLabel: new Date(cycle.timestamp).toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }))
  }, [filteredCycles])

  const speedVsCycleData = useMemo(() => {
    return filteredSpeedEvents
  }, [filteredSpeedEvents])

  const cycleDurationTrendData = useMemo(() => (
    filteredCycles
      .map((cycle, idx) => {
        const duration = Number(cycle?.duration)
        if (!Number.isFinite(duration)) return null
        return {
          index: idx + 1,
          cycle_duration: duration,
          timeLabel: new Date(cycle.timestamp).toLocaleString([], {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        }
      })
      .filter(Boolean)
  ), [filteredCycles])

  const mlAnomalyTimelineData = useMemo(() => (
    filteredCycles
      .filter((cycle) => cycle.decision && cycle.decision !== 'NORMAL')
      .map((cycle) => {
        const decision = String(cycle?.decision || '').toUpperCase()
        const cycleId = Number(cycle?.cycle_id)
        const globalCycleId = Number(cycle?.global_cycle_id ?? cycle?.cycle_id)
        const level = DECISION_TO_LEVEL[decision]
        if (!Number.isFinite(globalCycleId) || level == null) return null
        return {
          cycle_id: globalCycleId,
          decision,
          level,
          timestamp: new Date(cycle.timestamp).toISOString(),
          fill: INCIDENT_COLORS[decision] || INCIDENT_COLORS.CRITICAL,
        }
      })
      .filter(Boolean)
  ), [filteredCycles])

  const speedRegressionData = useMemo(() => {
    const points = [...speedVsCycleData].sort((a, b) => a.speed - b.speed)
    const n = points.length
    if (n < 2) return points.map((p) => ({ ...p, regression: null }))

    const sumX = points.reduce((acc, p) => acc + p.speed, 0)
    const sumY = points.reduce((acc, p) => acc + p.duration, 0)
    const sumXY = points.reduce((acc, p) => acc + (p.speed * p.duration), 0)
    const sumXX = points.reduce((acc, p) => acc + (p.speed * p.speed), 0)
    const denominator = (n * sumXX) - (sumX * sumX)
    const slope = denominator === 0 ? 0 : ((n * sumXY) - (sumX * sumY)) / denominator
    const intercept = (sumY - (slope * sumX)) / n

    return points.map((p) => ({
      ...p,
      regression: (slope * p.speed) + intercept,
    }))
  }, [speedVsCycleData])

  const throughputMetrics = useMemo(() => {
    const cycleCount = filteredCycles.length
    const windowHours = timeWindow.windowMs / (1000 * 60 * 60)
    const cyclesPerHour = windowHours > 0 ? cycleCount / windowHours : 0

    const durations = filteredCycles
      .map((cycle) => Number(cycle?.duration))
      .filter((value) => Number.isFinite(value) && value > 0)
    const avgCycle = durations.length
      ? durations.reduce((acc, value) => acc + value, 0) / durations.length
      : null

    return { avgCycle, cyclesPerHour, cycleCount }
  }, [filteredCycles, timeWindow.windowMs])

  const uptimeMetrics = useMemo(() => {
    const transitions = filteredStateTransitions
      .map((item) => ({
        ts: item.timestamp,
        state: String(item?.state || 'UNKNOWN').toUpperCase(),
      }))
      .filter((item) => item.ts != null)
      .sort((a, b) => a.ts - b.ts)

    const lastBeforeWindow = [...normalizedStateTransitions]
      .reverse()
      .find((item) => item.timestamp < timeWindow.startTime)

    let currentState = lastBeforeWindow?.state || transitions[0]?.state || 'UNKNOWN'
    let segmentStart = timeWindow.startTime
    let producingSeconds = 0

    transitions.forEach((transition) => {
      const segmentEnd = Math.min(transition.ts, timeWindow.now)
      const segmentDuration = Math.max(0, (segmentEnd - segmentStart) / 1000)
      if (currentState === 'PRODUCING') {
        producingSeconds += segmentDuration
      }
      currentState = transition.state
      segmentStart = transition.ts
    })

    if (segmentStart < timeWindow.now && currentState === 'PRODUCING') {
      producingSeconds += (timeWindow.now - segmentStart) / 1000
    }

    const windowSeconds = timeWindow.windowMs / 1000
    const rawPercentage = windowSeconds > 0 ? (producingSeconds / windowSeconds) * 100 : null
    const uptimePercentage = rawPercentage == null ? null : Math.max(0, Math.min(100, rawPercentage))
    return {
      producingSeconds,
      windowSeconds,
      uptimePercentage,
    }
  }, [filteredStateTransitions, normalizedStateTransitions, timeWindow])

  const machineHealth = useMemo(() => {
    const cycleRows = filteredCycles
    const cycleCount = cycleRows.length
    if (!cycleCount) {
      return { score: null, incidentCount: 0, cycleCount: 0 }
    }

    const incidentCount = cycleRows
      .filter((cycle) => {
        const decision = String(cycle?.decision || '').toUpperCase()
        return decision === 'WARNING' || decision === 'CRITICAL' || decision === 'EMERGENCY' || decision === 'EMERGENCY_STOP'
      })
      .length

    const healthRatio = 1 - (incidentCount / cycleCount)
    const score = Math.max(0, Math.min(100, healthRatio * 100))
    return { score, incidentCount, cycleCount }
  }, [filteredCycles])

  const filteredDataCounts = useMemo(() => ({
    cycles: filteredCycles.length,
    transitions: filteredStateTransitions.length,
    incidents: filteredIncidents.length,
    speedEvents: filteredSpeedEvents.length,
    systemEvents: filteredSystemEvents.length,
  }), [
    filteredCycles.length,
    filteredIncidents.length,
    filteredSpeedEvents.length,
    filteredStateTransitions.length,
    filteredSystemEvents.length,
  ])

  const healthVisual = useMemo(() => {
    if (machineHealth.score == null) {
      return { textColor: 'text-muted-foreground', dotColor: 'bg-gray-400' }
    }
    if (machineHealth.score > 90) {
      return { textColor: 'text-green-400', dotColor: 'bg-green-500' }
    }
    if (machineHealth.score >= 70) {
      return { textColor: 'text-yellow-500', dotColor: 'bg-yellow-400' }
    }
    return { textColor: 'text-red-600', dotColor: 'bg-red-500' }
  }, [machineHealth.score])

  const averageBySpeedRows = useMemo(() => {
    const grouped = speedVsCycleData.reduce((acc, point) => {
      const speed = Number(point.speed)
      if (!acc[speed]) {
        acc[speed] = { speed, total: 0, samples: 0 }
      }
      acc[speed].total += Number(point.duration)
      acc[speed].samples += 1
      return acc
    }, {})

    return Object.values(grouped)
      .map((row) => ({
        speed: row.speed,
        avgDuration: row.samples > 0 ? row.total / row.samples : 0,
        samples: row.samples,
      }))
      .sort((a, b) => a.speed - b.speed)
  }, [speedVsCycleData])

  const formatDuration = (seconds) => {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '-'
    const total = Math.max(0, Math.round(Number(seconds)))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const secs = total % 60

    if (hours > 0) {
      const parts = [`${hours}h`]
      if (minutes > 0) parts.push(`${minutes}m`)
      if (secs > 0) parts.push(`${secs}s`)
      return parts.join(' ')
    }

    if (minutes > 0) {
      const parts = [`${minutes}m`]
      if (secs > 0) parts.push(`${secs}s`)
      return parts.join(' ')
    }

    return `${secs}s`
  }

  const TrendTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]
    const valueLabel = d.name || 'Value'
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p className="font-medium">{label}</p>
        <p>{valueLabel}: <span className="font-semibold">{Number(d.value).toFixed(2)}</span></p>
      </div>
    )
  }

  const StateDistributionTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const point = payload[0]?.payload
    if (!point) return null
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p><span className="font-medium">State:</span> {point.name}</p>
        <p><span className="font-medium">Transitions:</span> {point.count}</p>
      </div>
    )
  }

  const SpeedVsCycleTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const point = payload[0]?.payload
    if (!point) return null
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p><span className="font-medium">Speed:</span> {Math.round(point.speed)} PWM</p>
        <p><span className="font-medium">Cycle Duration:</span> {Number(point.duration).toFixed(2)} s</p>
      </div>
    )
  }

  const MlAnomalyTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const point = payload[0]?.payload
    if (!point) return null
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p><span className="font-medium">Cycle ID:</span> {point.cycle_id}</p>
        <p><span className="font-medium">Decision:</span> {point.decision}</p>
        <p>
          <span className="font-medium">Time:</span>{' '}
          {point.timestamp ? new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A'}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <p className="text-destructive font-medium mb-4">{error}</p>
            <Button onClick={fetchAll} variant="outline">Retry</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-xs text-muted-foreground">Historical production data from InfluxDB</p>
          <p className="text-xs text-muted-foreground">
            Cycles: {filteredDataCounts.cycles} | Transitions: {filteredDataCounts.transitions} | Incidents: {filteredDataCounts.incidents}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODAY">Today</SelectItem>
              <SelectItem value="24H">Last 24 Hours</SelectItem>
              <SelectItem value="7D">Last 7 Days</SelectItem>
              <SelectItem value="30D">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Section 1 — Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4">
            <TitleWithHelp
              icon={Percent}
              title="Production Uptime"
              tooltip="Percentage of the selected time window where the machine was actively producing."
            />
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {uptimeMetrics.uptimePercentage != null ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold tracking-tight text-green-400">{uptimeMetrics.uptimePercentage.toFixed(1)} %</p>
                <p className="text-xs leading-snug text-muted-foreground">
                  Machine producing during {uptimeMetrics.uptimePercentage.toFixed(1)}% of the selected time window.
                </p>
                <p className="text-xs text-muted-foreground">
                  Producing time: {formatDuration(uptimeMetrics.producingSeconds)} / {formatDuration(uptimeMetrics.windowSeconds)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{EMPTY_WINDOW_MESSAGE}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-base">Machine Health Score</CardTitle>
            <CardDescription>Based on anomalies and cycles in the selected time window.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${healthVisual.dotColor}`} />
              {machineHealth.score != null ? (
                <p className={`text-2xl font-bold tracking-tight ${healthVisual.textColor}`}>
                  {machineHealth.score.toFixed(1)} %
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No cycles recorded in the selected time window.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Incidents: {machineHealth.incidentCount} / Cycles: {machineHealth.cycleCount}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-base">Production Throughput</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            <div className="space-y-1">
              <p className="text-2xl font-bold tracking-tight">
                {throughputMetrics.cyclesPerHour.toFixed(1)} cycles / hour
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                Cycles / hour in the selected time window.
              </p>
              <p className="text-xs text-muted-foreground">
                Cycles Count: {throughputMetrics.cycleCount} | Avg Cycle Time: {throughputMetrics.avgCycle != null ? `${throughputMetrics.avgCycle.toFixed(2)} s` : 'N/A'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 2 — Performance Trend */}
      <Card>
        <CardHeader className="pb-1 pt-4">
          <CardTitle className="text-base">Cycle Duration Stability Over Time</CardTitle>
          <p className="text-xs text-muted-foreground">
            Shows how production cycle time varies across recent cycles.
          </p>
        </CardHeader>
        <CardContent className="pt-0 pb-3 space-y-2">
          {cycleDurationTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220} style={{ background: 'transparent' }}>
              <LineChart data={cycleDurationTrendData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }} style={{ background: 'transparent' }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'transparent' }} content={<TrendTooltip />} />
                <Line type="monotone" dataKey="cycle_duration" name="Cycle Duration" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
              {EMPTY_WINDOW_MESSAGE}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3 — Speed Impact Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-base">Impact of Conveyor Speed on Cycle Duration</CardTitle>
            <p className="text-xs text-muted-foreground">
              Compares conveyor PWM speed settings with resulting production cycle duration.
            </p>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {speedRegressionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220} style={{ background: 'transparent' }}>
                <ComposedChart data={speedRegressionData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    type="number"
                    dataKey="speed"
                    name="Machine Speed (PWM)"
                    tick={{ fontSize: 10 }}
                    label={{ value: 'Machine Speed (PWM)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
                  />
                  <YAxis
                    type="number"
                    dataKey="duration"
                    name="Cycle Duration (seconds)"
                    tick={{ fontSize: 10 }}
                    label={{ value: 'Cycle Duration (seconds)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                  />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<SpeedVsCycleTooltip />} />
                  <Legend verticalAlign="top" align="right" height={28} />
                  <Line type="monotone" dataKey="regression" name="Regression Trend" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
                  <Scatter dataKey="duration" name="Cycle Duration vs Conveyor Speed" fill="#3b82f6" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
                {EMPTY_WINDOW_MESSAGE}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="text-base">Average Production Cycle Time by Conveyor Speed</CardTitle>
            <p className="text-xs text-muted-foreground">
              Displays the mean cycle duration measured for each conveyor speed level.
            </p>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {averageBySpeedRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Speed (PWM)</th>
                      <th className="py-2 pr-3 font-medium">Avg Cycle Duration (s)</th>
                      <th className="py-2 font-medium">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {averageBySpeedRows.map((row) => (
                      <tr key={row.speed} className="border-b last:border-0">
                        <td className="py-2 pr-3">{row.speed}</td>
                        <td className="py-2 pr-3">{row.avgDuration.toFixed(2)}</td>
                        <td className="py-2">{row.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{EMPTY_WINDOW_MESSAGE}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 4 — Anomaly Monitoring */}
      <Card>
        <CardHeader className="pb-1 pt-4">
          <CardTitle className="text-base">ML Anomaly Timeline</CardTitle>
          <p className="text-xs text-muted-foreground">
            An anomaly represents machine behavior that deviates from normal operating patterns detected by the ML model.
          </p>
        </CardHeader>
        <CardContent className="pt-0 pb-3 space-y-2">
          {mlAnomalyTimelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220} style={{ background: 'transparent' }}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number"
                  dataKey="cycle_id"
                  name="Cycle ID"
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="level"
                  name="Decision Level"
                  ticks={[0, 1, 2, 3]}
                  domain={[0, 3]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => {
                    if (value === 0) return 'NORMAL'
                    if (value === 1) return 'WARNING'
                    if (value === 2) return 'CRITICAL'
                    return 'EMERGENCY'
                  }}
                />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<MlAnomalyTooltip />} />
                <Scatter data={mlAnomalyTimelineData} dataKey="level">
                  {mlAnomalyTimelineData.map((entry, idx) => (
                    <Cell key={`ml-anomaly-${idx}`} fill={entry.fill} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
              No anomaly events detected in the selected time window. All cycles were classified as NORMAL.
            </div>
          )}
        </CardContent>
        <CardContent className="pt-0 pb-3">
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-green-500" />
              <span>Normal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-yellow-400" />
              <span>Warning</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
              <span>Critical</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Context */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1 pt-4">
            <TitleWithHelp
              icon={TrendingUp}
              title="ML Model Anomaly Score"
              tooltip="Shows anomaly score detected by the ML model. Higher values indicate abnormal machine behavior."
            />
            <p className="text-xs text-muted-foreground">
              Shows the anomaly score produced by the machine learning model for each cycle. Higher values indicate behavior further from normal patterns.
            </p>
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {anomalyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={210} style={{ background: 'transparent' }}>
                <LineChart data={anomalyChartData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }} style={{ background: 'transparent' }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'transparent' }} content={<TrendTooltip />} />
                  <Line type="monotone" dataKey="anomaly_score" name="Anomaly Score" stroke="#facc15" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[210px] flex items-center justify-center text-xs text-muted-foreground">
                No anomaly data for selected range.
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm bg-yellow-400" />
              <span>Anomaly Score</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <TitleWithHelp
              icon={Clock}
              title="Cycle Time Trend"
              tooltip="Displays duration of each production cycle. Sudden increases may indicate mechanical inefficiency."
            />
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {cycleChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={210} style={{ background: 'transparent' }}>
                <LineChart data={cycleChartData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }} style={{ background: 'transparent' }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'transparent' }} content={<TrendTooltip />} />
                  <Line type="monotone" dataKey="cycle_duration" name="Cycle Duration (s)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[210px] flex items-center justify-center text-xs text-muted-foreground">
                No cycle duration data for selected range.
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
              <span>Cycle Duration (seconds)</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <TitleWithHelp
              icon={BarChart3}
              title="Decision Distribution"
              tooltip="Distribution of ML decisions detected by the system."
            />
          </CardHeader>
          <CardContent className="pt-0 pb-3">
            {decisionChartData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={190} style={{ background: 'transparent' }}>
                <PieChart style={{ background: 'transparent' }}>
                  <Pie
                    data={decisionChartData.filter((d) => d.count > 0)}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {decisionChartData.filter((d) => d.count > 0).map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip cursor={{ fill: 'transparent' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[190px] flex items-center justify-center text-xs text-muted-foreground">
                {EMPTY_WINDOW_MESSAGE}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {decisionChartData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.fill }} />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4">
            <TitleWithHelp
              icon={Clock}
              title="Machine State Distribution"
              tooltip="Shows how often the machine was producing, idle, or stopped."
            />
            <p className="text-xs text-muted-foreground">
              Displays state transition counts observed during the selected time window.
            </p>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-2">
            {stateChartData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={190} style={{ background: 'transparent' }}>
                <BarChart data={stateChartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }} style={{ background: 'transparent' }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip cursor={{ fill: 'transparent' }} content={<StateDistributionTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {stateChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[190px] flex items-center justify-center text-xs text-muted-foreground">
                {EMPTY_WINDOW_MESSAGE}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {stateChartData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.fill }} />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Analytics
