import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface BreadcrumbSegment {
  label: string
  href?: string
  icon?: React.ComponentType<{ className?: string }>
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[]
  className?: string
}

export function Breadcrumb({ segments, className = '' }: BreadcrumbProps) {
  if (segments.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-sm ${className}`}>
      {segments.map((segment, idx) => {
        const isLast = idx === segments.length - 1
        const Icon = segment.icon

        return (
          <div key={idx} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />}

            {segment.href && !isLast ? (
              <Link
                to={segment.href}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors truncate"
              >
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate max-w-[200px]">{segment.label}</span>
              </Link>
            ) : (
              <span className={`flex items-center gap-1.5 truncate ${isLast ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate max-w-[200px]">{segment.label}</span>
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// Helper to create home segment
export function createHomeSegment(): BreadcrumbSegment {
  return {
    label: 'Dashboard',
    href: '/',
    icon: Home,
  }
}
