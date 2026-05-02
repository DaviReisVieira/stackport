import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EndpointManagement } from '@/components/EndpointManagement'

export default function Settings() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage StackPort configuration and preferences
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="endpoints" className="w-full">
          <TabsList>
            <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          </TabsList>
          <TabsContent value="endpoints" className="mt-6">
            <EndpointManagement />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
