import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { useThemeStore } from './store/themeStore'

// Initialize theme on load
const root = document.documentElement
const storedTheme = localStorage.getItem('theme-storage')
if (storedTheme) {
  try {
    const themeData = JSON.parse(storedTheme)
    if (themeData.state?.theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  } catch (e) {
    // Default to dark if parsing fails
    root.classList.add('dark')
  }
} else {
  // Default to dark
  root.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)



