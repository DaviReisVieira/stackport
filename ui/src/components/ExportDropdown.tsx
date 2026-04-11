import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download } from 'lucide-react'
import { exportData } from '@/lib/export'
import { toast } from 'sonner'

interface ExportDropdownProps {
  service: string
  resourceType: string
  data: Record<string, unknown>[]
}

export function ExportDropdown({ service, resourceType, data }: ExportDropdownProps) {
  const handleExport = (format: 'json' | 'csv') => {
    try {
      exportData({ service, resourceType, data, format })
    } catch (e) {
      toast.error('Export failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Export">
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('json')}>
          Export as JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('csv')}>
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
