import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useNotificationStore } from '../store/notificationStore'
import { useThemeStore } from '../store/themeStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Alert, AlertDescription } from '../components/ui/Alert'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { Activity, Shield, Mail, User, Lock, UserPlus, LogIn, Sun, Moon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const Login = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const { login, register, isAuthenticated, fetchUser } = useAuthStore()
  const { success, error: notifyError } = useNotificationStore()
  const { theme, setTheme } = useThemeStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard')
    }
  }, [isAuthenticated, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      if (isRegister) {
        const result = await register(username, email, password)
        if (result.success) {
          success('Registration successful! Please login.')
          setIsRegister(false)
          setUsername('')
          setEmail('')
          setPassword('')
        } else {
          const errorMsg = result.error || 'Registration failed'
          setError(errorMsg)
          notifyError(errorMsg)
        }
      } else {
        const result = await login(username, password)
        if (result.success) {
          await fetchUser()
          success('Login successful!')
          navigate('/dashboard')
        } else {
          const errorMsg = result.error || 'Login failed'
          setError(errorMsg)
          notifyError(errorMsg)
        }
      }
    } catch (err) {
      const errorMsg = err.message || 'An error occurred'
      setError(errorMsg)
      notifyError(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="border-2 shadow-lg">
          <CardHeader className="space-y-1 text-center pb-6">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="flex justify-center mb-4"
            >
              <div className="rounded-full bg-primary/10 p-4">
                <Activity className="h-10 w-10 text-primary" />
              </div>
            </motion.div>
            <CardTitle className="text-3xl font-bold flex items-center justify-center gap-2">
              <Shield className="h-7 w-7 text-primary" />
              Punching Station Control
            </CardTitle>
            <CardDescription className="text-base pt-2">
              {isRegister ? 'Create a new account' : 'Sign in to your account'}
            </CardDescription>
            <div className="pt-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant={theme === 'light' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('light')}
                  className="gap-2"
                  aria-label="Switch to day mode"
                >
                  <Sun className="h-4 w-4" />
                  Day mode
                </Button>
                <Button
                  type="button"
                  variant={theme === 'dark' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('dark')}
                  className="gap-2"
                  aria-label="Switch to night mode"
                >
                  <Moon className="h-4 w-4" />
                  Night mode
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                className="space-y-2"
              >
                <Label htmlFor="username" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </motion.div>

              <AnimatePresence>
                {isRegister && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-2 overflow-hidden"
                  >
                    <Label htmlFor="email" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter email"
                      required
                      disabled={isLoading}
                      className="h-11"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: isRegister ? 0.25 : 0.25 }}
                className="space-y-2"
              >
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </motion.div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
              >
                <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={isLoading}>
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Processing...</span>
                    </div>
                  ) : isRegister ? (
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4" />
                      <span>Register</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <LogIn className="h-4 w-4" />
                      <span>Login</span>
                    </div>
                  )}
                </Button>
              </motion.div>
            </form>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.35 }}
              className="mt-6 text-center"
            >
              <button
                type="button"
                onClick={() => {
                  setIsRegister(!isRegister)
                  setError('')
                }}
                className="text-sm text-primary hover:underline font-medium transition-colors"
                disabled={isLoading}
              >
                {isRegister
                  ? 'Already have an account? Login'
                  : "Don't have an account? Register"}
              </button>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}

export default Login
