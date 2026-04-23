import { create } from 'zustand'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const authStore = create((set) => ({
  user: null,
  token: localStorage.getItem('token') || null,
  isAuthenticated: !!localStorage.getItem('token'),

  login: async (username, password) => {
    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        username,
        password,
      })
      const { access_token } = response.data
      localStorage.setItem('token', access_token)
      
      // Get user info
      const userResponse = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      
      set({ token: access_token, user: userResponse.data, isAuthenticated: true })
      return { success: true }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: error.response?.data?.detail || 'Login failed' }
    }
  },

  register: async (username, email, password) => {
    try {
      const response = await axios.post(`${API_URL}/api/auth/register`, {
        username,
        email,
        password,
      })
      return { success: true, data: response.data }
    } catch (error) {
      console.error('Register error:', error)
      return { success: false, error: error.response?.data?.detail || 'Registration failed' }
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null, isAuthenticated: false })
    // Disconnect WebSocket on logout
    if (typeof window !== 'undefined' && window.wsManager) {
      window.wsManager.disconnect()
    }
  },

  fetchUser: async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      set({ token: null, user: null, isAuthenticated: false })
      return
    }

    // Quick validation: JWT tokens have 3 parts separated by dots
    if (!token.includes('.') || token.split('.').length !== 3) {
      // Invalid token format, remove it silently
      localStorage.removeItem('token')
      set({ token: null, user: null, isAuthenticated: false })
      return
    }

    // Use axios with silent error handling
    try {
      const response = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true, // Accept all status codes without throwing
      })
      
      if (response.status === 200) {
        set({ user: response.data, token, isAuthenticated: true })
      } else {
        // 401 or other 4xx - invalid token, handle silently (expected when not logged in)
        localStorage.removeItem('token')
        set({ token: null, user: null, isAuthenticated: false })
      }
    } catch (error) {
      // Network errors or other unexpected issues (but validateStatus should prevent most)
      // Only log if it's not a 401
      if (error.response?.status && error.response.status !== 401) {
        console.error('Fetch user error:', error)
      }
      localStorage.removeItem('token')
      set({ token: null, user: null, isAuthenticated: false })
    }
  },
}))

export const useAuthStore = authStore



