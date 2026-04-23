import { create } from 'zustand'

const historyStore = create((set, get) => ({
  // Historical records (limited to last 1000 to prevent memory issues)
  decisions: [], // Array of decision records
  cycles: [], // Array of cycle feature records
  interpretations: [], // Array of interpretation records
  
  // Add a decision record
  addDecision: (decision) => {
    const cycleRef = decision.global_cycle_id ?? decision.cycle_id ?? 'unknown'
    const record = {
      ...decision,
      id: decision.id || `decision_${cycleRef}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: decision.timestamp || new Date().toISOString(),
      type: 'decision',
    }
    set((state) => ({
      decisions: [record, ...state.decisions].slice(0, 1000), // Keep last 1000
    }))
    return record
  },
  
  // Add a cycle record
  addCycle: (cycle) => {
    const cycleRef = cycle.global_cycle_id ?? cycle.cycle_id ?? 'unknown'
    const record = {
      ...cycle,
      id: cycle.id || `cycle_${cycleRef}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: cycle.timestamp || new Date().toISOString(),
      type: 'cycle',
    }
    set((state) => ({
      cycles: [record, ...state.cycles].slice(0, 1000), // Keep last 1000
    }))
    return record
  },
  
  // Add an interpretation record
  addInterpretation: (interpretation) => {
    const cycleRef = interpretation.global_cycle_id ?? interpretation.cycle_id ?? 'unknown'
    const record = {
      ...interpretation,
      id: interpretation.id || `interpretation_${cycleRef}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: interpretation.timestamp || new Date().toISOString(),
      type: 'interpretation',
    }
    set((state) => ({
      interpretations: [record, ...state.interpretations].slice(0, 1000), // Keep last 1000
    }))
    return record
  },
  
  // Clear all history
  clearHistory: () => {
    set({ decisions: [], cycles: [], interpretations: [] })
  },
  
  // Get combined history sorted by timestamp
  getCombinedHistory: (limit = 100) => {
    const { decisions, cycles, interpretations } = get()
    const combined = [
      ...decisions.map(d => ({ ...d, type: 'decision' })),
      ...cycles.map(c => ({ ...c, type: 'cycle' })),
      ...interpretations.map(i => ({ ...i, type: 'interpretation' })),
    ]
    return combined
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
  },
}))

export const useHistoryStore = historyStore

