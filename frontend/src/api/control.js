import api from './axios'

/**
 * Production Control API
 *
 * Four commands only (frozen contract):
 *   START_PRODUCTION  – begin automatic production
 *   STOP_PRODUCTION   – controlled normal stop
 *   EMERGENCY_STOP    – immediate safety stop (latched)
 *   RESET_SYSTEM      – clear faults, return to IDLE
 */
export const controlAPI = {
  startProduction: async () => {
    const response = await api.post('/api/control/start')
    return response.data
  },

  stopProduction: async () => {
    const response = await api.post('/api/control/stop')
    return response.data
  },

  emergencyStop: async () => {
    const response = await api.post('/api/control/emergency-stop')
    return response.data
  },

  resetSystem: async () => {
    const response = await api.post('/api/control/reset')
    return response.data
  },
}
