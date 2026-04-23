import { useMemo, useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select'
import { AlertTriangle, Search, ShieldCheck } from 'lucide-react'
import { useHistoryStore } from '../store/historyStore'
import { format } from 'date-fns'
import api from '../api/axios'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

const INCIDENT_LEVELS = ['WARNING', 'CRITICAL', 'EMERGENCY_STOP']
const LEVEL_VARIANT = {
  WARNING: 'warning',
  CRITICAL: 'critical',
  EMERGENCY_STOP: 'emergency',
}
const LEVEL_COLOR = {
  WARNING: '#facc15',
  CRITICAL: '#f97316',
  EMERGENCY_STOP: '#ef4444',
}
const LEVEL_LABEL = {
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  EMERGENCY_STOP: 'EMERGENCY',
}

const IncidentSummaryTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
      <p><span className="font-medium">Incident Type:</span> {point.type || 'N/A'}</p>
      <p><span className="font-medium">Count:</span> {point.count ?? 0}</p>
    </div>
  )
}

const History = () => {
  const { interpretations } = useHistoryStore()
  const [range, setRange] = useState('24h')
  const [severity, setSeverity] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedIncidentId, setSelectedIncidentId] = useState(null)
  const [summaryData, setSummaryData] = useState({ WARNING: 0, CRITICAL: 0, EMERGENCY_STOP: 0 })
  const [incidentRows, setIncidentRows] = useState([])

  useEffect(() => {
    let active = true
    const fetchIncidents = async () => {
      try {
        const response = await api.get('/api/history/incidents', { params: { range } })
        const rows = Array.isArray(response.data) ? response.data : []
        if (!active) return
        setIncidentRows(rows)
      } catch {
        if (!active) return
        setIncidentRows([])
      }
    }
    fetchIncidents()
    const timer = setInterval(fetchIncidents, 15000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [range])

  useEffect(() => {
    const counts = incidentRows.reduce((acc, incident) => {
      const decision = String(incident?.decision || '').toUpperCase()
      if (decision === 'WARNING' || decision === 'CRITICAL' || decision === 'EMERGENCY_STOP') {
        acc[decision] += 1
      }
      return acc
    }, { WARNING: 0, CRITICAL: 0, EMERGENCY_STOP: 0 })
    setSummaryData(counts)
  }, [incidentRows])

  const incidents = useMemo(() => {
    return incidentRows
      .filter((incident) => INCIDENT_LEVELS.includes(String(incident.decision || '').toUpperCase()))
      .filter((incident) => severity === 'all' || String(incident.decision || '').toUpperCase() === severity)
      .filter((incident) => {
        if (!search.trim()) return true
        return String(incident.global_cycle_id ?? incident.cycle_id ?? '').toLowerCase().includes(search.trim().toLowerCase())
      })
      .map((incident, idx) => ({
        ...incident,
        id: incident.id || `${incident.timestamp}-${incident.global_cycle_id ?? incident.cycle_id ?? 'na'}-${incident.decision || 'UNKNOWN'}-${idx}`,
        decision: String(incident.decision || '').toUpperCase(),
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  }, [incidentRows, range, severity, search])

  const selectedIncident = useMemo(() => {
    if (!incidents.length) return null
    return incidents.find((event) => event.id === selectedIncidentId) || incidents[0]
  }, [incidents, selectedIncidentId])

  const relatedInterpretation = useMemo(() => {
    const selectedGlobalCycleId = selectedIncident?.global_cycle_id ?? selectedIncident?.cycle_id
    if (!selectedGlobalCycleId) return null
    return interpretations.find((item) => (item.global_cycle_id ?? item.cycle_id) === selectedGlobalCycleId) || null
  }, [interpretations, selectedIncident])

  const chartData = [
    { type: 'WARNING', count: summaryData.WARNING, color: LEVEL_COLOR.WARNING },
    { type: 'CRITICAL', count: summaryData.CRITICAL, color: LEVEL_COLOR.CRITICAL },
    { type: 'EMERGENCY', count: summaryData.EMERGENCY_STOP, color: LEVEL_COLOR.EMERGENCY_STOP },
  ]

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incident Log</h1>
          <p className="text-sm text-muted-foreground">Warning and critical production events with interpretation context.</p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger>
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="WARNING">Warning</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="EMERGENCY_STOP">Emergency</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder="Search cycle ID"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incident Summary Graph */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Incident Type Distribution</CardTitle>
          <CardDescription>Distribution of non-normal decision events.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="type" />
                <YAxis allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  content={<IncidentSummaryTooltip />}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={52}>
                  {chartData.map((item, idx) => (
                    <Cell key={`incident-type-${idx}`} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLOR.WARNING }} />
              <span>Warning</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLOR.CRITICAL }} />
              <span>Critical</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLOR.EMERGENCY_STOP }} />
              <span>Emergency</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline + Details */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 flex-1 min-h-0">
        {/* Left panel */}
        <Card className="xl:col-span-3 h-full flex flex-col min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Incident Timeline</CardTitle>
            <CardDescription>{incidents.length} event{incidents.length === 1 ? '' : 's'} found</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <div className="h-full overflow-y-auto pr-1 space-y-2">
              {incidents.length > 0 ? (
                incidents.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    onClick={() => setSelectedIncidentId(event.id)}
                    className={`w-full text-left border rounded-md p-3 hover:bg-accent/50 transition-colors ${
                      selectedIncident?.id === event.id ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-1.5 self-stretch rounded-full"
                        style={{ backgroundColor: LEVEL_COLOR[event.decision] || '#9ca3af' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={LEVEL_VARIANT[event.decision] || 'default'}>
                              {LEVEL_LABEL[event.decision] || event.decision}
                            </Badge>
                            <span className="text-sm font-semibold">Cycle ID {event.global_cycle_id ?? event.cycle_id ?? 'N/A'}</span>
                          </div>
                          <span className="text-xs text-muted-foreground" title={format(new Date(event.timestamp), 'PPpp')}>
                            {format(new Date(event.timestamp), 'HH:mm:ss')}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {format(new Date(event.timestamp), 'HH:mm:ss')} | {event.decision} | Cycle ID {event.global_cycle_id ?? event.cycle_id ?? 'N/A'}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="h-full flex items-center justify-center">
                  <Card className="w-full max-w-md border-border/60 bg-muted/20">
                    <CardContent className="py-8 text-center">
                      <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">No incidents recorded</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        No anomaly events have been detected during the selected time window.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right panel */}
        <Card className="xl:col-span-2 h-full flex flex-col min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Incident Analysis</CardTitle>
            <CardDescription>Selected event information and AI interpretation.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <div className="h-full overflow-y-auto pr-1 space-y-4">
              {selectedIncident ? (
                <>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-muted-foreground">Cycle ID</span>
                      <p className="font-mono text-sm">{selectedIncident.global_cycle_id ?? selectedIncident.cycle_id ?? 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Timestamp</span>
                      <p className="text-sm">{format(new Date(selectedIncident.timestamp), 'PPpp')}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Decision Level</span>
                      <div className="mt-1">
                        <Badge variant={LEVEL_VARIANT[selectedIncident.decision] || 'default'}>
                          {selectedIncident.decision}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Reason</span>
                      <p className="text-sm">{selectedIncident.reason || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t space-y-3">
                    {relatedInterpretation ? (
                      <>
                        <div>
                          <span className="text-xs text-muted-foreground">Summary</span>
                          <p className="text-sm mt-1">
                            {relatedInterpretation?.authoritative_summary ||
                              relatedInterpretation?.interpretation?.summary ||
                              'No interpretation summary available.'}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Technical Explanation</span>
                          <p className="text-sm mt-1 text-muted-foreground">
                            {relatedInterpretation?.technical_explanation ||
                              relatedInterpretation?.interpretation?.severity_explanation ||
                              'No technical explanation available.'}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Recommended Actions</span>
                          {(relatedInterpretation?.recommended_actions ||
                            relatedInterpretation?.interpretation?.recommended_actions ||
                            []
                          ).length > 0 ? (
                            <ul className="mt-1 space-y-1">
                              {(relatedInterpretation?.recommended_actions ||
                                relatedInterpretation?.interpretation?.recommended_actions ||
                                []
                              ).map((action, idx) => (
                                <li key={`${action}-${idx}`} className="text-sm flex items-start gap-2">
                                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                                  <span>{action}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm mt-1 text-muted-foreground">No recommended actions available.</p>
                          )}
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Confidence Level</span>
                          <p className="text-sm mt-1">
                            {typeof relatedInterpretation?.confidence === 'number'
                              ? `${(relatedInterpretation.confidence * 100).toFixed(0)}%`
                              : relatedInterpretation?.confidence || 'N/A'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <Card className="border-border/60 bg-muted/20">
                        <CardContent className="py-4">
                          <p className="text-sm text-muted-foreground">AI interpretation not available for this incident.</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Select an incident to view details.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default History
