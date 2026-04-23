import { Wifi, WifiOff, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { useSystemStatusStore } from '../store/systemStatusStore'
import { useThemeStore } from '../store/themeStore'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Moon, Sun } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '../lib/utils'

const decisionLevelColors = {
  NORMAL: 'normal',
  WARNING: 'warning',
  CRITICAL: 'critical',
  EMERGENCY_STOP: 'emergency',
}

export function SystemStatusBar() {
  const { wsConnected, wsLastMessage, currentDecisionLevel, currentMachineState, supervisorOnline } = useSystemStatusStore()
  const { theme, toggleTheme } = useThemeStore()

  const getConnectionStatus = () => {
    if (wsConnected) {
      return {
        icon: <Wifi className="h-4 w-4" />,
        text: 'Live',
        color: 'normal',
      }
    }
    return {
      icon: <WifiOff className="h-4 w-4" />,
      text: 'Disconnected',
      color: 'emergency',
    }
  }

  const status = getConnectionStatus()
  const lastUpdate = wsLastMessage
    ? formatDistanceToNow(new Date(wsLastMessage), { addSuffix: true })
    : 'Never'
  const machineState = wsConnected
    ? (currentMachineState || 'WAITING').toUpperCase()
    : 'DISCONNECTED'
  const machineStateVariant = (() => {
    if (machineState === 'DISCONNECTED') return 'emergency'
    if (machineState === 'IDLE') return 'info'
    if (machineState === 'PRODUCING') return 'normal'
    if (machineState === 'STOPPING') return 'warning'
    if (machineState === 'EMERGENCY_STOP') return 'emergency'
    return 'secondary'
  })()
  const supervisorStatusText = supervisorOnline ? 'ONLINE' : 'OFFLINE'
  const supervisorStatusVariant = supervisorOnline ? 'normal' : 'emergency'

  return (
    <div className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span className="text-xs font-semibold text-muted-foreground">WebSocket</span>
            {status.icon}
            <Badge variant={status.color}>{status.text}</Badge>
          </div>
          
          {currentDecisionLevel && (
            <div className="flex items-center gap-2 rounded-md border px-2 py-1">
              <span className="text-xs font-semibold text-muted-foreground">Decision</span>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <Badge variant={decisionLevelColors[currentDecisionLevel] || 'default'}>
                {currentDecisionLevel}
              </Badge>
            </div>
          )}
          
          <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-muted-foreground">
            <span className="text-xs font-semibold">Last Update</span>
            <Clock className="h-4 w-4" />
            <span className="whitespace-nowrap">{lastUpdate}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Supervisor</span>
            <Badge
              variant={supervisorStatusVariant}
              className="rounded-md px-2 py-1 font-bold tracking-wide"
            >
              {supervisorStatusText}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Machine</span>
            <Badge
              variant={machineStateVariant}
              className="rounded-md px-2 py-1 font-bold tracking-wide"
            >
              {machineState}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

