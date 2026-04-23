import { create } from 'zustand'

const notificationStore = create((set, get) => ({
  notifications: [],
  
  addNotification: (notification) => {
    const id = Date.now() + Math.random()
    const newNotification = {
      id,
      timestamp: new Date().toISOString(),
      ...notification,
    }
    
    set((state) => ({
      notifications: [newNotification, ...state.notifications].slice(0, 100), // Keep last 100
    }))
    
    // Auto-remove after duration (default 5 seconds)
    const duration = notification.duration || 5000
    if (duration > 0) {
      setTimeout(() => {
        get().removeNotification(id)
      }, duration)
    }
    
    return id
  },
  
  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
  },
  
  clearAll: () => {
    set({ notifications: [] })
  },
  
  // Helper methods for common notification types
  success: (message, title = 'Success') => {
    return get().addNotification({
      type: 'success',
      title,
      message,
      severity: 'normal',
    })
  },
  
  error: (message, title = 'Error') => {
    return get().addNotification({
      type: 'error',
      title,
      message,
      severity: 'emergency',
      duration: 8000, // Errors stay longer
    })
  },
  
  warning: (message, title = 'Warning') => {
    return get().addNotification({
      type: 'warning',
      title,
      message,
      severity: 'warning',
    })
  },
  
  info: (message, title = 'Info') => {
    return get().addNotification({
      type: 'info',
      title,
      message,
      severity: 'info',
    })
  },
}))

export const useNotificationStore = notificationStore

