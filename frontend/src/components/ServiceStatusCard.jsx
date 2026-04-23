import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Circle } from 'lucide-react'
import { useSystemStatusStore } from '../store/systemStatusStore'

const StatusDot = ({ online }) => (
  <Circle
    className={`h-3 w-3 ${online ? 'text-green-500 fill-green-500' : 'text-red-500 fill-red-500'}`}
  />
)

const serviceOnline = (status) => status === 'healthy' || status === 'degraded'

export default function ServiceStatusCard() {
  const { wsConnected, supervisorOnline, services } = useSystemStatusStore()

  const rows = [
    {
      name: 'MQTT Broker',
      online: wsConnected,
      tooltip: 'Message broker connecting RevPi and backend',
    },
    {
      name: 'Backend API',
      online: serviceOnline(services.backend?.status) || wsConnected,
      tooltip: 'Data processing and WebSocket server',
    },
    {
      name: 'ML Service',
      online: serviceOnline(services.mlService?.status),
      tooltip: 'Machine learning anomaly detection',
    },
    {
      name: 'ChatGPT Service',
      online: serviceOnline(services.chatgptService?.status),
      tooltip: 'AI interpretation engine',
    },
    {
      name: 'RevPi Supervisor',
      online: supervisorOnline,
      tooltip: 'Industrial controller managing machine',
    },
    {
      name: 'WebSocket',
      online: wsConnected,
      tooltip: 'Real-time frontend data stream',
    },
  ]

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Service Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-2 text-sm" title={row.tooltip}>
            <StatusDot online={row.online} />
            <span>{row.name}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

