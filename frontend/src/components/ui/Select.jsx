import React, { useState, useRef, useEffect, Children } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Select({ value, onValueChange, children, disabled, ...props }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const contentRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        contentRef.current &&
        !contentRef.current.contains(event.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // Extract SelectTrigger and SelectContent from children
  let trigger = null
  let content = null
  let selectedLabel = null

  Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === SelectTrigger) {
        // Find selected label from SelectContent children
        const contentChild = Children.toArray(children).find(
          c => React.isValidElement(c) && c.type === SelectContent
        )
        if (contentChild) {
          Children.forEach(contentChild.props.children, (item) => {
            if (React.isValidElement(item) && item.type === SelectItem && item.props.value === value) {
              selectedLabel = item.props.children
            }
          })
        }
        
        trigger = React.cloneElement(child, {
          ref: triggerRef,
          onClick: () => !disabled && setOpen(!open),
          'aria-expanded': open,
          disabled,
          selectedLabel,
        })
      } else if (child.type === SelectContent) {
        content = React.cloneElement(child, {
          ref: contentRef,
          open,
          onValueChange: (val) => {
            onValueChange?.(val)
            setOpen(false)
          },
        })
      }
    }
  })

  return (
    <div className="relative" {...props}>
      {trigger}
      {open && content}
    </div>
  )
}

export const SelectTrigger = React.forwardRef(({ className, children, selectedLabel, ...props }, ref) => {
  return (
    <button
      type="button"
      ref={ref}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span>{selectedLabel || children}</span>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </button>
  )
})
SelectTrigger.displayName = 'SelectTrigger'

export const SelectContent = React.forwardRef(({ className, children, open, onValueChange, ...props }, ref) => {
  if (!open) return null
  
  // Clone SelectItem children to pass onValueChange
  const childrenWithHandler = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === SelectItem) {
      return React.cloneElement(child, {
        onSelect: onValueChange,
      })
    }
    return child
  })
  
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-card text-card-foreground shadow-lg mt-1 w-full opacity-100",
        className
      )}
      {...props}
    >
      <div className="p-1">{childrenWithHandler}</div>
    </div>
  )
})
SelectContent.displayName = 'SelectContent'

export function SelectItem({ className, children, value, onSelect, ...props }) {
  return (
    <div
      role="option"
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      onClick={() => onSelect?.(value)}
      {...props}
    >
      {children}
    </div>
  )
}

export function SelectValue({ placeholder, children }) {
  return <span>{children || placeholder}</span>
}
