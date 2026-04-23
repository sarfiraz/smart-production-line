import { Card, CardContent } from './ui/Card'

const items = [
  { label: 'Booting', color: 'bg-[#94a3b8]', tooltip: 'System boot sequence' },
  { label: 'Idle', color: 'bg-[#d1d5db] border', tooltip: 'Machine idle' },
  { label: 'Producing', color: 'bg-green-500', tooltip: 'Normal production' },
  { label: 'Stopped', color: 'bg-[#6b7280]', tooltip: 'Machine stopped' },
  { label: 'Warning', color: 'bg-yellow-400', tooltip: 'Warning detected' },
  { label: 'Critical', color: 'bg-orange-500', tooltip: 'Critical anomaly' },
  { label: 'Emergency Stop', color: 'bg-red-500', tooltip: 'Emergency stop' },
]

export default function TimelineLegend() {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2" title={item.tooltip}>
              <span className={`h-3 w-3 rounded-sm ${item.color}`} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

