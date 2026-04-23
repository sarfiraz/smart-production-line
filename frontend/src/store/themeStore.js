import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const themeStore = create(
  persist(
    (set) => ({
      theme: 'dark', // Default to dark for industrial feel
      setTheme: (theme) => {
        set({ theme })
        // Apply theme to document
        const root = document.documentElement
        if (theme === 'dark') {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      },
      toggleTheme: () => {
        set((state) => {
          const newTheme = state.theme === 'dark' ? 'light' : 'dark'
          const root = document.documentElement
          if (newTheme === 'dark') {
            root.classList.add('dark')
          } else {
            root.classList.remove('dark')
          }
          return { theme: newTheme }
        })
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        // Apply theme on load
        if (state) {
          const root = document.documentElement
          if (state.theme === 'dark') {
            root.classList.add('dark')
          } else {
            root.classList.remove('dark')
          }
        }
      },
    }
  )
)

export const useThemeStore = themeStore

