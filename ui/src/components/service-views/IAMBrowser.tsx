import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Breadcrumb, createHomeSegment } from '@/components/Breadcrumb'
import {
  fetchIAMUsers,
  fetchIAMUserDetail,
  fetchIAMRoles,
  fetchIAMRoleDetail,
  fetchIAMGroups,
  fetchIAMGroupDetail,
  fetchIAMPolicies,
  fetchIAMPolicyDetail,
} from '@/lib/api'
import type {
  IAMUser,
  IAMRole,
  IAMGroup,
  IAMPolicy,
  IAMUserDetail,
  IAMRoleDetail,
  IAMGroupDetail,
  IAMPolicyDetail,
} from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { JsonViewer } from '@/components/JsonViewer'
import { getServiceIcon } from '@/lib/service-icons'
import { useFetch } from '@/hooks/useFetch'
import { Input } from '@/components/ui/input'
import { ExportDropdown } from '@/components/ExportDropdown'
import {
  Users,
  User,
  UserCircle,
  Shield,
  Key,
  FileText,
  Tag,
  ExternalLink,
  ChevronRight,
} from 'lucide-react'

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function EntityCard({
  icon: Icon,
  title,
  value,
  className,
}: {
  icon: typeof User
  title: string
  value: string | number
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function UserDetailSheet({
  userName,
  open,
  onOpenChange,
}: {
  userName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fetcher = useCallback(() => fetchIAMUserDetail(userName), [userName])
  const { data, loading } = useFetch<IAMUserDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {userName}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!loading && data && (
          <div className="space-y-6 mt-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                User Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User ID</span>
                  <span className="font-mono text-xs">{data.user.UserId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ARN</span>
                  <span className="font-mono text-xs break-all">{data.user.Arn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Path</span>
                  <span className="font-mono text-xs">{data.user.Path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-xs">{formatDate(data.user.CreateDate)}</span>
                </div>
                {data.user.PasswordLastUsed && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Password Last Used</span>
                    <span className="text-xs">{formatDate(data.user.PasswordLastUsed)}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Attached Managed Policies ({data.attached_policies.length})
              </h3>
              {data.attached_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No managed policies attached</p>
              ) : (
                <div className="space-y-2">
                  {data.attached_policies.map((policy) => (
                    <div
                      key={policy.PolicyArn}
                      className="flex items-center justify-between p-2 rounded border bg-card"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{policy.PolicyName}</span>
                      </div>
                      <code className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {policy.PolicyArn}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Inline Policies ({data.inline_policies.length})
              </h3>
              {data.inline_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inline policies</p>
              ) : (
                <div className="space-y-3">
                  {data.inline_policies.map((policy) => (
                    <details key={policy.name} className="group">
                      <summary className="cursor-pointer p-2 rounded border bg-card hover:bg-accent flex items-center justify-between">
                        <span className="text-sm font-medium">{policy.name}</span>
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2">
                        <JsonViewer data={policy.document} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Groups ({data.groups.length})
              </h3>
              {data.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not a member of any groups</p>
              ) : (
                <div className="space-y-2">
                  {data.groups.map((group) => (
                    <div key={group.GroupId} className="flex items-center gap-2 p-2 rounded border bg-card">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{group.GroupName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Key className="h-4 w-4" />
                Access Keys ({data.access_keys.length})
              </h3>
              {data.access_keys.length === 0 ? (
                <p className="text-xs text-muted-foreground">No access keys</p>
              ) : (
                <div className="space-y-2">
                  {data.access_keys.map((key) => (
                    <div
                      key={key.AccessKeyId}
                      className="flex items-center justify-between p-2 rounded border bg-card"
                    >
                      <code className="text-xs font-mono">{key.AccessKeyId}</code>
                      <Badge variant={key.Status === 'Active' ? 'default' : 'secondary'}>
                        {key.Status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {Object.keys(data.tags).length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Tags ({Object.keys(data.tags).length})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.tags).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function RoleDetailSheet({
  roleName,
  open,
  onOpenChange,
}: {
  roleName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fetcher = useCallback(() => fetchIAMRoleDetail(roleName), [roleName])
  const { data, loading } = useFetch<IAMRoleDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            {roleName}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!loading && data && (
          <div className="space-y-6 mt-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <UserCircle className="h-4 w-4" />
                Role Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role ID</span>
                  <span className="font-mono text-xs">{data.role.RoleId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ARN</span>
                  <span className="font-mono text-xs break-all">{data.role.Arn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Path</span>
                  <span className="font-mono text-xs">{data.role.Path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-xs">{formatDate(data.role.CreateDate)}</span>
                </div>
                {data.role.MaxSessionDuration && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Session Duration</span>
                    <span className="text-xs">{data.role.MaxSessionDuration}s</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Trust Policy (AssumeRolePolicyDocument)
              </h3>
              <JsonViewer data={data.trust_policy} />
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Attached Managed Policies ({data.attached_policies.length})
              </h3>
              {data.attached_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No managed policies attached</p>
              ) : (
                <div className="space-y-2">
                  {data.attached_policies.map((policy) => (
                    <div
                      key={policy.PolicyArn}
                      className="flex items-center justify-between p-2 rounded border bg-card"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{policy.PolicyName}</span>
                      </div>
                      <code className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {policy.PolicyArn}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Inline Policies ({data.inline_policies.length})
              </h3>
              {data.inline_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inline policies</p>
              ) : (
                <div className="space-y-3">
                  {data.inline_policies.map((policy) => (
                    <details key={policy.name} className="group">
                      <summary className="cursor-pointer p-2 rounded border bg-card hover:bg-accent flex items-center justify-between">
                        <span className="text-sm font-medium">{policy.name}</span>
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2">
                        <JsonViewer data={policy.document} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {Object.keys(data.tags).length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Tags ({Object.keys(data.tags).length})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.tags).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function GroupDetailSheet({
  groupName,
  open,
  onOpenChange,
}: {
  groupName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fetcher = useCallback(() => fetchIAMGroupDetail(groupName), [groupName])
  const { data, loading } = useFetch<IAMGroupDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {groupName}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!loading && data && (
          <div className="space-y-6 mt-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Group Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Group ID</span>
                  <span className="font-mono text-xs">{data.group.GroupId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ARN</span>
                  <span className="font-mono text-xs break-all">{data.group.Arn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Path</span>
                  <span className="font-mono text-xs">{data.group.Path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-xs">{formatDate(data.group.CreateDate)}</span>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                Members ({data.users.length})
              </h3>
              {data.users.length === 0 ? (
                <p className="text-xs text-muted-foreground">No members</p>
              ) : (
                <div className="space-y-2">
                  {data.users.map((user) => (
                    <div key={user.UserId} className="flex items-center gap-2 p-2 rounded border bg-card">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{user.UserName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Attached Managed Policies ({data.attached_policies.length})
              </h3>
              {data.attached_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No managed policies attached</p>
              ) : (
                <div className="space-y-2">
                  {data.attached_policies.map((policy) => (
                    <div
                      key={policy.PolicyArn}
                      className="flex items-center justify-between p-2 rounded border bg-card"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{policy.PolicyName}</span>
                      </div>
                      <code className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {policy.PolicyArn}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Inline Policies ({data.inline_policies.length})
              </h3>
              {data.inline_policies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No inline policies</p>
              ) : (
                <div className="space-y-3">
                  {data.inline_policies.map((policy) => (
                    <details key={policy.name} className="group">
                      <summary className="cursor-pointer p-2 rounded border bg-card hover:bg-accent flex items-center justify-between">
                        <span className="text-sm font-medium">{policy.name}</span>
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-2">
                        <JsonViewer data={policy.document} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PolicyDetailSheet({
  policyArn,
  open,
  onOpenChange,
}: {
  policyArn: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fetcher = useCallback(() => fetchIAMPolicyDetail(policyArn), [policyArn])
  const { data, loading } = useFetch<IAMPolicyDetail>(fetcher, 10000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {data?.policy.PolicyName || 'Policy Detail'}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {!loading && data && (
          <div className="space-y-6 mt-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Policy Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Policy ID</span>
                  <span className="font-mono text-xs">{data.policy.PolicyId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ARN</span>
                  <span className="font-mono text-xs break-all">{data.policy.Arn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Path</span>
                  <span className="font-mono text-xs">{data.policy.Path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Default Version</span>
                  <span className="text-xs">{data.policy.DefaultVersionId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Attachments</span>
                  <Badge>{data.policy.AttachmentCount}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-xs">{formatDate(data.policy.CreateDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-xs">{formatDate(data.policy.UpdateDate)}</span>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Policy Document
              </h3>
              <JsonViewer data={data.document} />
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                Attached To
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Users ({data.attached_to.users.length})</p>
                  {data.attached_to.users.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <div className="space-y-1">
                      {data.attached_to.users.map((user) => (
                        <div key={user.UserName} className="flex items-center gap-2 p-2 rounded border bg-card">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{user.UserName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Roles ({data.attached_to.roles.length})</p>
                  {data.attached_to.roles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <div className="space-y-1">
                      {data.attached_to.roles.map((role) => (
                        <div key={role.RoleName} className="flex items-center gap-2 p-2 rounded border bg-card">
                          <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{role.RoleName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Groups ({data.attached_to.groups.length})</p>
                  {data.attached_to.groups.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None</p>
                  ) : (
                    <div className="space-y-1">
                      {data.attached_to.groups.map((group) => (
                        <div key={group.GroupName} className="flex items-center gap-2 p-2 rounded border bg-card">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{group.GroupName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {Object.keys(data.tags).length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Tags ({Object.keys(data.tags).length})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.tags).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function IAMBrowser() {
  const usersFetcher = useCallback(() => fetchIAMUsers(), [])
  const rolesFetcher = useCallback(() => fetchIAMRoles(), [])
  const groupsFetcher = useCallback(() => fetchIAMGroups(), [])
  const policiesFetcher = useCallback(() => fetchIAMPolicies('Local'), [])

  const { data: usersData, loading: usersLoading } = useFetch<{ users: IAMUser[] }>(usersFetcher, 10000)
  const { data: rolesData, loading: rolesLoading } = useFetch<{ roles: IAMRole[] }>(rolesFetcher, 10000)
  const { data: groupsData, loading: groupsLoading } = useFetch<{ groups: IAMGroup[] }>(groupsFetcher, 10000)
  const { data: policiesData, loading: policiesLoading } = useFetch<{ policies: IAMPolicy[] }>(policiesFetcher, 10000)

  const [searchParams, setSearchParams] = useSearchParams()

  // Read selected entity from URL params
  const entityType = searchParams.get('type') // 'user' | 'role' | 'group' | 'policy'
  const entityName = searchParams.get('name')

  const selectedUser = entityType === 'user' ? entityName : null
  const selectedRole = entityType === 'role' ? entityName : null
  const selectedGroup = entityType === 'group' ? entityName : null
  const selectedPolicy = entityType === 'policy' ? entityName : null

  // Helpers to update URL params
  const setSelectedUser = (user: string | null) => {
    if (user === null) {
      setSearchParams({})
    } else {
      setSearchParams({ type: 'user', name: user })
    }
  }

  const setSelectedRole = (role: string | null) => {
    if (role === null) {
      setSearchParams({})
    } else {
      setSearchParams({ type: 'role', name: role })
    }
  }

  const setSelectedGroup = (group: string | null) => {
    if (group === null) {
      setSearchParams({})
    } else {
      setSearchParams({ type: 'group', name: group })
    }
  }

  const setSelectedPolicy = (policy: string | null) => {
    if (policy === null) {
      setSearchParams({})
    } else {
      setSearchParams({ type: 'policy', name: policy })
    }
  }

  const [userSearch, setUserSearch] = useState('')
  const [roleSearch, setRoleSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [policySearch, setPolicySearch] = useState('')

  const filteredUsers = useMemo(() => {
    if (!usersData?.users) return []
    if (!userSearch) return usersData.users
    const lower = userSearch.toLowerCase()
    return usersData.users.filter((u) =>
      u.UserName.toLowerCase().includes(lower) || u.Arn.toLowerCase().includes(lower)
    )
  }, [usersData, userSearch])

  const filteredRoles = useMemo(() => {
    if (!rolesData?.roles) return []
    if (!roleSearch) return rolesData.roles
    const lower = roleSearch.toLowerCase()
    return rolesData.roles.filter((r) =>
      r.RoleName.toLowerCase().includes(lower) || r.Arn.toLowerCase().includes(lower)
    )
  }, [rolesData, roleSearch])

  const filteredGroups = useMemo(() => {
    if (!groupsData?.groups) return []
    if (!groupSearch) return groupsData.groups
    const lower = groupSearch.toLowerCase()
    return groupsData.groups.filter((g) =>
      g.GroupName.toLowerCase().includes(lower) || g.Arn.toLowerCase().includes(lower)
    )
  }, [groupsData, groupSearch])

  const filteredPolicies = useMemo(() => {
    if (!policiesData?.policies) return []
    if (!policySearch) return policiesData.policies
    const lower = policySearch.toLowerCase()
    return policiesData.policies.filter((p) =>
      p.PolicyName.toLowerCase().includes(lower) || p.Arn.toLowerCase().includes(lower)
    )
  }, [policiesData, policySearch])

  return (
    <div className="space-y-6 p-6">
      <Breadcrumb segments={[createHomeSegment(), { label: 'IAM', icon: getServiceIcon('iam') }]} />
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" />
          IAM Browser
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Navigate IAM entities, inspect policies, and understand relationships
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <EntityCard icon={User} title="Users" value={usersData?.users.length ?? 0} />
        <EntityCard icon={Users} title="Groups" value={groupsData?.groups.length ?? 0} />
        <EntityCard icon={UserCircle} title="Roles" value={rolesData?.roles.length ?? 0} />
        <EntityCard icon={FileText} title="Policies" value={policiesData?.policies.length ?? 0} />
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="users">
            Users
            {usersData && <Badge variant="secondary" className="ml-2">{usersData.users.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="groups">
            Groups
            {groupsData && <Badge variant="secondary" className="ml-2">{groupsData.groups.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="roles">
            Roles
            {rolesData && <Badge variant="secondary" className="ml-2">{rolesData.roles.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="policies">
            Policies
            {policiesData && <Badge variant="secondary" className="ml-2">{policiesData.policies.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>IAM Users</span>
                <div className="flex items-center gap-2">
                  {filteredUsers.length > 0 && <ExportDropdown service="iam" resourceType="users" data={filteredUsers as unknown as Record<string, unknown>[]} />}
                  <Input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersLoading && <Skeleton className="h-64 w-full" />}
              {!usersLoading && filteredUsers.length === 0 && (
                <EmptyState
                  icon={User}
                  title="No users found"
                  description={userSearch ? 'Try adjusting your search' : 'No IAM users exist yet'}
                />
              )}
              {!usersLoading && filteredUsers.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User Name</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>ARN</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow
                        key={user.UserId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedUser(user.UserName)}
                      >
                        <TableCell className="font-medium">{user.UserName}</TableCell>
                        <TableCell className="font-mono text-xs">{user.UserId}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{user.Arn}</TableCell>
                        <TableCell className="text-xs">{formatDate(user.CreateDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>IAM Groups</span>
                <div className="flex items-center gap-2">
                  {filteredGroups.length > 0 && <ExportDropdown service="iam" resourceType="groups" data={filteredGroups as unknown as Record<string, unknown>[]} />}
                  <Input
                    type="text"
                    placeholder="Search groups..."
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {groupsLoading && <Skeleton className="h-64 w-full" />}
              {!groupsLoading && filteredGroups.length === 0 && (
                <EmptyState
                  icon={Users}
                  title="No groups found"
                  description={groupSearch ? 'Try adjusting your search' : 'No IAM groups exist yet'}
                />
              )}
              {!groupsLoading && filteredGroups.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group Name</TableHead>
                      <TableHead>Group ID</TableHead>
                      <TableHead>ARN</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGroups.map((group) => (
                      <TableRow
                        key={group.GroupId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedGroup(group.GroupName)}
                      >
                        <TableCell className="font-medium">{group.GroupName}</TableCell>
                        <TableCell className="font-mono text-xs">{group.GroupId}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{group.Arn}</TableCell>
                        <TableCell className="text-xs">{formatDate(group.CreateDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>IAM Roles</span>
                <div className="flex items-center gap-2">
                  {filteredRoles.length > 0 && <ExportDropdown service="iam" resourceType="roles" data={filteredRoles as unknown as Record<string, unknown>[]} />}
                  <Input
                    type="text"
                    placeholder="Search roles..."
                    value={roleSearch}
                    onChange={(e) => setRoleSearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rolesLoading && <Skeleton className="h-64 w-full" />}
              {!rolesLoading && filteredRoles.length === 0 && (
                <EmptyState
                  icon={UserCircle}
                  title="No roles found"
                  description={roleSearch ? 'Try adjusting your search' : 'No IAM roles exist yet'}
                />
              )}
              {!rolesLoading && filteredRoles.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role Name</TableHead>
                      <TableHead>Role ID</TableHead>
                      <TableHead>ARN</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRoles.map((role) => (
                      <TableRow
                        key={role.RoleId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedRole(role.RoleName)}
                      >
                        <TableCell className="font-medium">{role.RoleName}</TableCell>
                        <TableCell className="font-mono text-xs">{role.RoleId}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{role.Arn}</TableCell>
                        <TableCell className="text-xs">{formatDate(role.CreateDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>IAM Policies (Customer Managed)</span>
                <div className="flex items-center gap-2">
                  {filteredPolicies.length > 0 && <ExportDropdown service="iam" resourceType="policies" data={filteredPolicies as unknown as Record<string, unknown>[]} />}
                  <Input
                    type="text"
                    placeholder="Search policies..."
                    value={policySearch}
                    onChange={(e) => setPolicySearch(e.target.value)}
                    className="w-64"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {policiesLoading && <Skeleton className="h-64 w-full" />}
              {!policiesLoading && filteredPolicies.length === 0 && (
                <EmptyState
                  icon={FileText}
                  title="No policies found"
                  description={policySearch ? 'Try adjusting your search' : 'No customer-managed IAM policies exist yet'}
                />
              )}
              {!policiesLoading && filteredPolicies.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy Name</TableHead>
                      <TableHead>ARN</TableHead>
                      <TableHead>Attachments</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPolicies.map((policy) => (
                      <TableRow
                        key={policy.PolicyId}
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelectedPolicy(policy.Arn)}
                      >
                        <TableCell className="font-medium">{policy.PolicyName}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{policy.Arn}</TableCell>
                        <TableCell>
                          <Badge>{policy.AttachmentCount}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(policy.UpdateDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedUser && (
        <UserDetailSheet
          userName={selectedUser}
          open={!!selectedUser}
          onOpenChange={(open) => !open && setSelectedUser(null)}
        />
      )}

      {selectedRole && (
        <RoleDetailSheet
          roleName={selectedRole}
          open={!!selectedRole}
          onOpenChange={(open) => !open && setSelectedRole(null)}
        />
      )}

      {selectedGroup && (
        <GroupDetailSheet
          groupName={selectedGroup}
          open={!!selectedGroup}
          onOpenChange={(open) => !open && setSelectedGroup(null)}
        />
      )}

      {selectedPolicy && (
        <PolicyDetailSheet
          policyArn={selectedPolicy}
          open={!!selectedPolicy}
          onOpenChange={(open) => !open && setSelectedPolicy(null)}
        />
      )}
    </div>
  )
}
