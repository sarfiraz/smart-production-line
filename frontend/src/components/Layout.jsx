import { useState } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { SystemStatusBar } from './SystemStatusBar'
import { ToastContainer } from './Toast'
import { useWebSocket } from '../hooks/useWebSocket'
import { 
  LayoutDashboard, 
  History, 
  Settings,
  LogOut, 
  Menu, 
  X,
  MessageSquare,
  Activity,
  BarChart3
} from 'lucide-react'
import { Button } from './ui/Button'
import { cn } from '../lib/utils'

const Layout = () => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  // Initialize WebSocket connection at Layout level (persists across route changes)
  useWebSocket()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/controls', label: 'Controls', icon: Settings },
    { path: '/history', label: 'Incident Log', icon: History },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    { path: '/ai-interpretation', label: 'AI Interpretation', icon: MessageSquare },
    { path: '/status', label: 'System Status', icon: Activity },
  ]

  const isActive = (path) => location.pathname === path

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r bg-card transition-all duration-300 ease-in-out",
          sidebarOpen ? "w-64" : "w-16"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar Header */}
          <div className="flex h-16 items-center justify-between border-b px-4">
            {sidebarOpen && (
              <h1 className="text-lg font-bold">Punching Station Control</h1>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="ml-auto"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive(item.path)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {sidebarOpen && <span>{item.label}</span>}
                </Link>
              )
            })}

          </nav>

          {/* User Section */}
          <div className="border-t p-4">
            <div className={cn("flex items-center gap-3", !sidebarOpen && "justify-center")}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              {sidebarOpen && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.username}</p>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <SystemStatusBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  )
}

export default Layout
