import { useEffect, Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { ToastContainer } from './components/Toast'

// Lazy load pages for better performance
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Controls = lazy(() => import('./pages/Controls'))
const History = lazy(() => import('./pages/History'))
const Interpretations = lazy(() => import('./pages/Interpretations'))
const Status = lazy(() => import('./pages/Status'))
const Analytics = lazy(() => import('./pages/Analytics'))

// Loading fallback component
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="text-center">
      <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
      <p className="mt-4 text-muted-foreground">Loading...</p>
    </div>
  </div>
)

function App() {
  const { isAuthenticated, fetchUser } = useAuthStore()

  useEffect(() => {
    // Fetch user data on app load if token exists
    // Only fetch once, even in StrictMode (use empty deps)
    const token = localStorage.getItem('token')
    if (token) {
      fetchUser()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - only run once on mount

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="history" element={<History />} />
            <Route path="interpretations" element={<Navigate to="/ai-interpretation" replace />} />
            <Route path="ai-interpretation" element={<Interpretations />} />
            <Route path="status" element={<Status />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="controls" element={<Controls />} />
          </Route>
        </Routes>
      </Suspense>
      <ToastContainer />
    </Router>
  )
}

export default App

