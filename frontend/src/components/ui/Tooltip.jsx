import React from 'react'

// Simplified tooltip - just shows title attribute for now
export function TooltipProvider({ children }) {
  return <>{children}</>
}

export function Tooltip({ children }) {
  return <>{children}</>
}

export function TooltipTrigger({ asChild, children, ...props }) {
  if (asChild && React.isValidElement(children)) {
    // Add title for native tooltip
    const title = props.title || props.tooltip
    return React.cloneElement(children, { ...props, title })
  }
  return <span {...props}>{children}</span>
}

export function TooltipContent({ children, ...props }) {
  // For now, just return null - tooltips will use native browser tooltips via title attribute
  return null
}
