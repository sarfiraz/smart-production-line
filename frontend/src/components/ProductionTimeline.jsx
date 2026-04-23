import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card'
import api from '../api/axios'
import { useSystemStatusStore } from '../store/systemStatusStore'

const STATE_COLORS = {
  PRODUCING: 'bg-green-500',
  WARNING: 'bg-yellow-400',
  CRITICAL: 'bg-orange-500',
  EMERGENCY_STOP: 'bg-red-500',
  IDLE: 'bg-[#d1d5db]',
  STOPPED: 'bg-[#6b7280]',
  BOOTING: 'bg-[#94a3b8]',
}

const normalizeState = (value) => {
  if (!value) return 'IDLE'
  const state = String(value).toUpperCase()
  return STATE_COLORS[state] ? state : 'IDLE'
}

const getTimelineItems = (raw) => {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.transitions)) return raw.transitions
  if (Array.isArray(raw?.data)) return raw.data
  return []
}

const formatHHmm = (timestamp) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

const formatDuration = (start, end) => {
  const durationMs = Math.max(0, end - start)
  const durationMinutes = Math.floor(durationMs / 60000)
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export default function ProductionTimeline() {
  const [timelineData, setTimelineData] = useState([])
  const [speedEvents, setSpeedEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const currentMachineState = useSystemStatusStore((state) => state.currentMachineState)

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        const [stateRes, eventsRes] = await Promise.all([
          api.get('/api/history/state-transitions'),
          api.get('/api/history/system-events'),
        ])
        setTimelineData(getTimelineItems(stateRes.data))
        const rows = Array.isArray(eventsRes.data) ? eventsRes.data : []
        setSpeedEvents(rows.filter((event) => {
          const eventType = String(event?.event_type || '').toUpperCase()
          const description = String(event?.description || '')
          return eventType === 'SET_SPEED' || description.includes('Speed changed')
        }))
      } catch (err) {
        setTimelineData([])
        setSpeedEvents([])
      } finally {
        setLoading(false)
      }
    }

    fetchTimeline()
  }, [])

  const segments = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const dayStart = midnight.getTime()
    const dayEnd = dayStart + dayMs

    const transitions = timelineData
      .filter((row) => row?.timestamp && row?.state)
      .map((row) => ({
        timestamp: new Date(row.timestamp).getTime(),
        state: normalizeState(row.state),
      }))
      .filter((row) => Number.isFinite(row.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)

    if (transitions.length === 0) {
      const now = Date.now()
      const clampedNow = Math.min(Math.max(now, dayStart), dayEnd)
      const nowWidth = ((clampedNow - dayStart) / dayMs) * 100
      return [{
        state: normalizeState(currentMachineState),
        leftPct: 0,
        widthPct: Math.max(nowWidth, 0.5),
        start: dayStart,
        end: clampedNow,
      }]
    }

    // Determine state at midnight from the latest known transition at/before midnight.
    const stateAtMidnight =
      [...transitions].reverse().find((item) => item.timestamp <= dayStart)?.state ||
      transitions.find((item) => item.timestamp >= dayStart && item.timestamp < dayEnd)?.state ||
      'IDLE'

    const todayTransitions = transitions.filter(
      (item) => item.timestamp > dayStart && item.timestamp < dayEnd
    )

    // Build transition points anchored to absolute day start.
    const points = [{ timestamp: dayStart, state: stateAtMidnight }, ...todayTransitions]

    // If multiple transitions share the same timestamp, keep only the latest state.
    const deduped = []
    for (const point of points) {
      const last = deduped[deduped.length - 1]
      if (last && last.timestamp === point.timestamp) {
        deduped[deduped.length - 1] = point
      } else {
        deduped.push(point)
      }
    }

    const prepared = []
    const now = Date.now()
    for (let i = 0; i < deduped.length; i++) {
      const current = deduped[i]
      const next = deduped[i + 1]
      const start = Math.max(dayStart, current.timestamp)
      const end = Math.min(dayEnd, next ? next.timestamp : now)
      if (end <= start) continue

      prepared.push({
        state: current.state,
        leftPct: ((start - dayStart) / dayMs) * 100,
        widthPct: ((end - start) / dayMs) * 100,
        start,
        end,
      })
    }

    if (!prepared.length) {
      return [{ state: stateAtMidnight, leftPct: 0, widthPct: 100, start: dayStart, end: dayEnd }]
    }
    return prepared
  }, [timelineData, currentMachineState])

  const speedMarkers = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const dayStart = midnight.getTime()
    const dayEnd = dayStart + dayMs

    const extractSpeedFromDescription = (description) => {
      const match = String(description || '').match(/(\d+)\s*PWM/)
      const value = match ? Number(match[1]) : NaN
      return Number.isFinite(value) ? value : null
    }

    return (speedEvents || [])
      .map((event) => {
        const ts = new Date(event?.timestamp).getTime()
        if (!Number.isFinite(ts) || ts < dayStart || ts > dayEnd) return null
        const speed = extractSpeedFromDescription(event?.description)
        return {
          leftPct: ((ts - dayStart) / dayMs) * 100,
          time: ts,
          speed,
        }
      })
      .filter(Boolean)
  }, [speedEvents])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">24-Hour Machine State Timeline</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Visualizes machine operational states throughout the last 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="relative h-8 w-full rounded-md border overflow-hidden">
            {segments.map((segment, idx) => (
              <div
                key={`${segment.state}-${idx}`}
                className={`absolute top-0 h-full ${STATE_COLORS[segment.state] || 'bg-gray-300'}`}
                style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%` }}
                title={`${segment.state}
${formatHHmm(segment.start)} -> ${formatHHmm(segment.end)}
Duration: ${formatDuration(segment.start, segment.end)}`}
              />
            ))}
            {speedMarkers.map((marker, idx) => (
              <div
                key={`speed-marker-${idx}-${marker.time}`}
                className="absolute top-0 h-full w-px bg-blue-500 z-10"
                style={{ left: `${marker.leftPct}%` }}
                title={`Speed changed
Speed: ${marker.speed != null ? `${marker.speed} PWM` : 'Unknown'}
Time: ${formatHHmm(marker.time)}`}
              />
            ))}
          </div>
          <div className="relative h-4 text-xs text-muted-foreground">
            <span className="absolute left-0">00:00</span>
            <span className="absolute left-1/4 -translate-x-1/2">06:00</span>
            <span className="absolute left-1/2 -translate-x-1/2">12:00</span>
            <span className="absolute left-3/4 -translate-x-1/2">18:00</span>
            <span className="absolute right-0">24:00</span>
          </div>
          {loading && <p className="text-xs text-muted-foreground">Loading timeline...</p>}
        </div>
      </CardContent>
    </Card>
  )
}

