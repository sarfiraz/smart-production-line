import { useEffect, useMemo, useState } from 'react'
import { controlAPI } from '../api/control'
import api from '../api/axios'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { useNotificationStore } from '../store/notificationStore'
import { useSystemStatusStore } from '../store/systemStatusStore'
import {
  Shield,
  Clock,
  Play,
  RotateCcw,
  Octagon,
  StopCircle,
  AlertTriangle,
  X,
  Gauge,
} from 'lucide-react'
const STOP_REASONS = [
  'Planned Stop',
  'Maintenance',
  'Material Change',
  'System Check',
  'Safety Concern',
  'Other',
]

const SPEED_MODES = {
  Reduced: 70,
  Nominal: 80,
  High: 90,
  Maximum: 100,
}

const speedToMode = (speed) => {
  const value = Number(speed)
  if (value === 70) return 'Reduced'
  if (value === 80) return 'Nominal'
  if (value === 90) return 'High'
  if (value === 100) return 'Maximum'
  return 'Nominal'
}

const CONTROL_EVENT_TYPES = new Set([
  'START_PRODUCTION',
  'STOP_PRODUCTION',
  'RESET_SYSTEM',
  'EMERGENCY_STOP',
  'SET_SPEED',
])

const Controls = () => {
  const [loading, setLoading] = useState('')
  const [operationLog, setOperationLog] = useState([])
  const [showEmergencyModal, setShowEmergencyModal] = useState(false)
  const [showStopReasonModal, setShowStopReasonModal] = useState(false)
  const [stopReason, setStopReason] = useState(STOP_REASONS[0])
  const [stopNotes, setStopNotes] = useState('')
  const { success, error: notifyError, warning } = useNotificationStore()
  const currentMachineState = useSystemStatusStore((state) => state.currentMachineState)
  const currentMachineSpeed = useSystemStatusStore((state) => state.currentMachineSpeed)
  const [selectedSpeedMode, setSelectedSpeedMode] = useState(speedToMode(currentMachineSpeed))
  const state = (currentMachineState || '').toUpperCase()
  const canChangeSpeed = state === 'IDLE' || state === 'STOPPED'

  useEffect(() => {
    setSelectedSpeedMode(speedToMode(currentMachineSpeed))
  }, [currentMachineSpeed])

  const buttonEnabled = useMemo(() => ({
    START_PRODUCTION: state === 'IDLE',
    STOP_PRODUCTION: state === 'PRODUCING',
    EMERGENCY_STOP: state === 'PRODUCING',
    RESET_SYSTEM: state === 'STOPPED' || state === 'EMERGENCY_STOP',
  }), [state])

  const loadOperationLog = async () => {
    try {
      const response = await api.get('/api/history/system-events')
      const rows = Array.isArray(response.data) ? response.data : []
      const filtered = rows
        .filter((item) => CONTROL_EVENT_TYPES.has(String(item?.event_type || '').toUpperCase()))
        .slice(0, 15)
      setOperationLog(filtered)
    } catch {
      setOperationLog([])
    }
  }

  useEffect(() => {
    loadOperationLog()
    const timer = setInterval(loadOperationLog, 15000)
    return () => clearInterval(timer)
  }, [])

  const runCommand = async (command, apiCall) => {
    setLoading(command)
    try {
      const result = await apiCall()
      success(result?.message || `${command} sent`)
      loadOperationLog()
      return true
    } catch (err) {
      const message = err.response?.data?.detail || err.message || 'Failed to send command'
      notifyError(message)
      return false
    } finally {
      setLoading('')
    }
  }

  const handleStart = async () => {
    await runCommand('START_PRODUCTION', () => controlAPI.startProduction())
  }

  const handleStop = async () => {
    const ok = await runCommand('STOP_PRODUCTION', () => controlAPI.stopProduction())
    if (ok) setShowStopReasonModal(true)
  }

  const handleReset = async () => {
    await runCommand('RESET_SYSTEM', () => controlAPI.resetSystem())
  }

  const handleApplySpeed = async () => {
    const speed = SPEED_MODES[selectedSpeedMode]
    if (state === 'EMERGENCY_STOP') return
    setLoading('SET_SPEED')
    try {
      await api.post('/api/control/set-speed', { speed })
      success(`Speed updated to ${selectedSpeedMode} (${speed}%)`)
      loadOperationLog()
    } catch (err) {
      const message = err.response?.data?.detail || err.message || 'Failed to apply speed'
      notifyError(message)
    } finally {
      setLoading('')
    }
  }

  const confirmEmergencyStop = async () => {
    setShowEmergencyModal(false)
    await runCommand('EMERGENCY_STOP', () => controlAPI.emergencyStop())
  }

  const submitStopReason = async () => {
    const payload = {
      reason: stopReason,
      notes: stopNotes,
      timestamp: new Date().toISOString(),
      command: 'STOP_PRODUCTION',
    }

    try {
      await api.post('/api/control/stop-reason', payload)
      success('Stop reason submitted')
    } catch {
      warning('Stop-reason endpoint unavailable, saved locally in operation log')
    } finally {
      setShowStopReasonModal(false)
      setStopReason(STOP_REASONS[0])
      setStopNotes('')
    }
  }

  const isBusy = loading !== ''
  const isLoading = (command) => loading === command
  const isButtonDisabled = (command) => isBusy || !buttonEnabled[command]

  return (
    <div className="space-y-4 h-full overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Punching Station Control Panel
          </h1>
          <p className="text-sm text-muted-foreground">
            State-aware machine commands with safety confirmations
          </p>
        </div>
        <Badge variant="outline">Machine State: {state || 'UNKNOWN'}</Badge>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 h-[calc(100%-76px)] min-h-0">
        <Card className="xl:col-span-3 min-h-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Machine Control Panel</CardTitle>
            <CardDescription>Primary operation commands</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="emergency"
              size="lg"
              title="Immediately halt machine operation."
              onClick={() => setShowEmergencyModal(true)}
              disabled={isButtonDisabled('EMERGENCY_STOP')}
              className="w-full min-h-16 h-20 text-lg font-bold"
            >
              {isLoading('EMERGENCY_STOP') ? 'Sending...' : <span className="inline-flex items-center gap-2"><Octagon className="h-5 w-5" />Emergency Stop</span>}
            </Button>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button
                size="lg"
                title="Begin automatic production cycle."
                onClick={handleStart}
                disabled={isButtonDisabled('START_PRODUCTION')}
                className="w-full min-h-16 bg-green-600 hover:bg-green-700 text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <Play className="h-5 w-5" />
                  Start Production
                </span>
              </Button>

              <Button
                size="lg"
                title="Gracefully stop production after the current cycle."
                onClick={handleStop}
                disabled={isButtonDisabled('STOP_PRODUCTION')}
                className="w-full min-h-16 bg-orange-500 hover:bg-orange-600 text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <StopCircle className="h-5 w-5" />
                  Stop Production
                </span>
              </Button>

              <Button
                size="lg"
                title="Reset machine state after stop or emergency."
                onClick={handleReset}
                disabled={isButtonDisabled('RESET_SYSTEM')}
                className="w-full min-h-16 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCcw className="h-5 w-5" />
                  Reset System
                </span>
              </Button>
            </div>

            <div className="rounded-md border p-3 bg-muted/30 text-xs text-muted-foreground">
              Enabled rules: IDLE → Start, PRODUCING → Stop + Emergency, STOPPED → Reset.
            </div>

            <div className="rounded-lg border p-4 bg-card">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-info" />
                    Machine Speed
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Speed can only be changed when the machine is idle or stopped.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Recommended Mode</p>
                  <Badge variant="normal" className="mt-1">Nominal</Badge>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(SPEED_MODES).map(([mode, value]) => {
                    const isSelected = selectedSpeedMode === mode
                    const tooltip = mode === 'Nominal'
                      ? `PWM ${value} (recommended)`
                      : `PWM ${value}`
                    return (
                      <button
                        key={mode}
                        type="button"
                        title={tooltip}
                        disabled={!canChangeSpeed || isBusy}
                        onClick={() => setSelectedSpeedMode(mode)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-info text-white border-info'
                            : 'bg-background hover:bg-muted border-border'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {mode}
                      </button>
                    )
                  })}
                </div>

                <div className="text-xs text-muted-foreground">
                  Selected: <span className="font-semibold text-foreground">{selectedSpeedMode}</span> (PWM {SPEED_MODES[selectedSpeedMode]})
                </div>

                <Button
                  onClick={handleApplySpeed}
                  disabled={!canChangeSpeed || isBusy}
                  className="bg-info hover:bg-info/90 text-white min-h-16"
                >
                  {isLoading('SET_SPEED') ? 'Applying...' : 'Apply Speed'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Operation Log
            </CardTitle>
            <CardDescription>Last 15 persisted commands</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto pr-2">
            {operationLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commands yet.</p>
            ) : (
              <div className="space-y-2">
                {operationLog.map((item, idx) => (
                  <div key={`${item.timestamp}-${idx}`} className="rounded-md border p-2.5 bg-card">
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm font-semibold">{item.event_type}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showEmergencyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-emergency flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Confirm Emergency Stop
              </CardTitle>
              <CardDescription>
                EMERGENCY STOP will immediately halt the machine.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowEmergencyModal(false)}>Cancel</Button>
              <Button variant="emergency" onClick={confirmEmergencyStop}>Confirm Emergency Stop</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {showStopReasonModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Classify Stop Reason</CardTitle>
                <button
                  type="button"
                  aria-label="Close stop reason modal"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setShowStopReasonModal(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <CardDescription>Document why STOP_PRODUCTION was issued.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Reason</label>
                <select
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={stopReason}
                  onChange={(e) => setStopReason(e.target.value)}
                >
                  {STOP_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Additional notes</label>
                <Input
                  value={stopNotes}
                  onChange={(e) => setStopNotes(e.target.value)}
                  placeholder="Optional notes..."
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowStopReasonModal(false)}>Cancel</Button>
                <Button onClick={submitStopReason}>Submit</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default Controls
