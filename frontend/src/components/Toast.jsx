import { X } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'
import { Alert, AlertDescription, AlertTitle } from './ui/Alert'
import { Badge } from './ui/Badge'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'

const severityMap = {
  normal: 'normal',
  warning: 'warning',
  critical: 'critical',
  emergency: 'emergency',
  info: 'info',
}

export function ToastContainer() {
  const { notifications, removeNotification } = useNotificationStore()

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm">
      <AnimatePresence>
        {notifications.map((notification) => (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3 }}
          >
            <Alert
              variant={severityMap[notification.severity] || 'default'}
              className="shadow-lg"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {notification.title && (
                    <AlertTitle className="flex items-center gap-2">
                      {notification.title}
                      {notification.severity && (
                        <Badge variant={severityMap[notification.severity]}>
                          {notification.severity.toUpperCase()}
                        </Badge>
                      )}
                    </AlertTitle>
                  )}
                  <AlertDescription className="mt-1">
                    {notification.message}
                  </AlertDescription>
                </div>
                <button
                  onClick={() => removeNotification(notification.id)}
                  className="ml-4 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Alert>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

