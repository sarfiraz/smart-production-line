import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { useHistoryStore } from '../store/historyStore'
import { useSystemStatusStore } from '../store/systemStatusStore'

const formatSeconds = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${num.toFixed(2)} s`
}

export default function CyclePerformanceCard() {
  const { cycles } = useHistoryStore()
  const { lastCycleFeatures } = useSystemStatusStore()

  const metrics = useMemo(() => {
    const cyclesToday = lastCycleFeatures?.global_cycle_id ?? lastCycleFeatures?.cycle_id ?? 0

    const latestCycleId = (
      lastCycleFeatures?.global_cycle_id
      ?? lastCycleFeatures?.cycle_id
      ?? cycles[0]?.global_cycle_id
      ?? cycles[0]?.cycle_id
      ?? '-'
    )
    const lastCycleDuration = lastCycleFeatures?.features?.cycle_duration ?? cycles[0]?.features?.cycle_duration

    const recentDurations = cycles
      .slice(0, 20)
      .map((cycle) => Number(cycle.features?.cycle_duration))
      .filter((duration) => Number.isFinite(duration))

    const avgCycleDuration = recentDurations.length
      ? recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length
      : null

    return {
      cyclesToday,
      latestCycleId,
      lastCycleDuration,
      avgCycleDuration,
    }
  }, [cycles, lastCycleFeatures])

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Cycle Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground">CYCLES TODAY</p>
          <p className="text-2xl font-bold">{metrics.cyclesToday}</p>
          <p className="text-xs text-muted-foreground mt-1">Latest Cycle ID: {metrics.latestCycleId}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">LAST CYCLE</p>
          <p className="text-2xl font-bold">{formatSeconds(metrics.lastCycleDuration)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">AVG CYCLE (LAST 20)</p>
          <p className="text-2xl font-bold">{formatSeconds(metrics.avgCycleDuration)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

