import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Star, Cloud, Monitor, Loader2 } from 'lucide-react'
import { useEndpoint } from '@/hooks/useEndpoint'
import { addEndpoint, updateEndpoint, deleteEndpoint, setDefaultEndpoint } from '@/lib/api'
import { EndpointFormDialog } from '@/components/EndpointFormDialog'
import { EmptyState } from '@/components/EmptyState'
import { toast } from 'sonner'
import type { Endpoint } from '@/lib/types'

function HealthDot({ health }: { health: string }) {
  const color =
    health === 'healthy'
      ? 'bg-emerald-400'
      : health === 'unhealthy'
        ? 'bg-red-400'
        : 'bg-yellow-400'
  return <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />
}

export function EndpointManagement() {
  const { endpoints, refresh, setActiveEndpoint } = useEndpoint()
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add')
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleAdd = () => {
    setFormMode('add')
    setSelectedEndpoint(null)
    setFormOpen(true)
  }

  const handleEdit = (endpoint: Endpoint) => {
    setFormMode('edit')
    setSelectedEndpoint(endpoint)
    setFormOpen(true)
  }

  const handleDelete = (endpoint: Endpoint) => {
    setEndpointToDelete(endpoint)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!endpointToDelete) return

    setDeleting(true)
    try {
      await deleteEndpoint(endpointToDelete.name)
      toast.success(`Endpoint "${endpointToDelete.name}" deleted`)
      refresh()
      setDeleteDialogOpen(false)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(`Failed to delete endpoint: ${errorMsg}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleSetDefault = async (name: string) => {
    try {
      await setDefaultEndpoint(name)
      toast.success(`Default endpoint set to "${name}"`)
      setActiveEndpoint(name)
      refresh()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error(`Failed to set default: ${errorMsg}`)
    }
  }

  const handleFormSubmit = async (name: string, url: string | null, region: string | null) => {
    if (formMode === 'add') {
      await addEndpoint(name, url, region)
      toast.success(`Endpoint "${name}" added`)
    } else {
      await updateEndpoint(name, url, region)
      toast.success(`Endpoint "${name}" updated`)
    }
    refresh()
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Endpoint Configuration</CardTitle>
              <CardDescription>
                Manage AWS endpoints and local emulators. Switch between endpoints to browse different environments.
              </CardDescription>
            </div>
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Endpoint
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {endpoints.length === 0 ? (
            <EmptyState
              icon={Monitor}
              title="No endpoints configured"
              description="Add your first endpoint to get started"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>URL / Type</TableHead>
                  <TableHead className="w-[120px]">Region</TableHead>
                  <TableHead className="w-[100px]">Health</TableHead>
                  <TableHead className="w-[100px]">Source</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => (
                  <TableRow key={endpoint.name}>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleSetDefault(endpoint.name)}
                            disabled={endpoint.active}
                            className="disabled:opacity-50"
                          >
                            <Star
                              className={`h-4 w-4 ${
                                endpoint.active
                                  ? 'fill-yellow-500 text-yellow-500'
                                  : 'text-muted-foreground hover:text-yellow-500'
                              }`}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {endpoint.active ? 'Default endpoint' : 'Set as default'}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="font-medium">{endpoint.name}</TableCell>
                    <TableCell>
                      {endpoint.url === null ? (
                        <Badge variant="outline" className="text-orange-500 border-orange-500">
                          <Cloud className="mr-1 h-3 w-3" />
                          Real AWS
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">{endpoint.url}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{endpoint.region}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <HealthDot health={endpoint.health} />
                        <span className="text-sm capitalize">{endpoint.health}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={endpoint.source === 'env' ? 'secondary' : 'outline'}>
                        {endpoint.source === 'env' ? 'Environment' : 'User'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(endpoint)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Edit endpoint
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(endpoint)}
                              disabled={endpoint.source === 'env' || endpoints.length === 1}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {endpoint.source === 'env'
                              ? 'Cannot delete environment endpoint'
                              : endpoints.length === 1
                                ? 'Cannot delete last endpoint'
                                : 'Delete endpoint'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EndpointFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initialName={selectedEndpoint?.name}
        initialUrl={selectedEndpoint?.url}
        initialRegion={selectedEndpoint?.region}
        source={selectedEndpoint?.source}
        onSubmit={handleFormSubmit}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Endpoint</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the endpoint "{endpointToDelete?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
