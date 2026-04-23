import { cn } from '../../lib/utils'
import { cva } from 'class-variance-authority'

const alertVariants = cva(
  "relative w-full rounded-lg border p-4",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        normal: "border-normal/50 bg-normal/10 text-normal-foreground",
        warning: "border-warning/50 bg-warning/10 text-warning-foreground",
        critical: "border-critical/50 bg-critical/10 text-critical-foreground",
        emergency: "border-emergency/50 bg-emergency/10 text-emergency-foreground",
        info: "border-info/50 bg-info/10 text-info-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export function Alert({ className, variant, ...props }) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }) {
  return (
    <h5
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }) {
  return (
    <div
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
}

