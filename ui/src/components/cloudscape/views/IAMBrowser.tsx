import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import {
  fetchIAMGroupDetail,
  fetchIAMGroups,
  fetchIAMPolicies,
  fetchIAMPolicyDetail,
  fetchIAMRoleDetail,
  fetchIAMRoles,
  fetchIAMUserDetail,
  fetchIAMUsers,
} from '@/lib/api'
import type {
  IAMAttachedPolicy,
  IAMGroup,
  IAMGroupDetail,
  IAMInlinePolicy,
  IAMPolicy,
  IAMPolicyDetail,
  IAMRole,
  IAMRoleDetail,
  IAMUser,
  IAMUserDetail,
} from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

type EntityType = 'user' | 'group' | 'role' | 'policy'

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function jsonBlock(value: unknown) {
  return (
    <Box variant="code">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre>
    </Box>
  )
}

function kvGrid(rows: Array<[string, string]>) {
  return (
    <ColumnLayout columns={2} variant="text-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <Box variant="awsui-key-label">{label}</Box>
          <Box fontSize="body-s">{value}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

function tagsBadges(tags: Record<string, string>) {
  const entries = Object.entries(tags ?? {})
  if (entries.length === 0) return <Box color="text-status-inactive">No tags</Box>
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {entries.map(([key, value]) => (
        <Badge key={key} color="grey">
          {key}: {value}
        </Badge>
      ))}
    </SpaceBetween>
  )
}

function policiesPanel(attached: IAMAttachedPolicy[], inline: IAMInlinePolicy[]) {
  return (
    <SpaceBetween size="m">
      <Header variant="h3" counter={`(${attached.length})`}>
        Attached policies
      </Header>
      {attached.length === 0 ? (
        <Box color="text-status-inactive">No attached policies</Box>
      ) : (
        <Table
          variant="embedded"
          items={attached}
          trackBy="PolicyArn"
          columnDefinitions={[
            { id: 'name', header: 'Name', cell: (p) => p.PolicyName },
            { id: 'arn', header: 'ARN', cell: (p) => <Box fontSize="body-s">{p.PolicyArn}</Box> },
          ]}
        />
      )}
      <Header variant="h3" counter={`(${inline.length})`}>
        Inline policies
      </Header>
      {inline.length === 0 ? (
        <Box color="text-status-inactive">No inline policies</Box>
      ) : (
        <SpaceBetween size="xs">
          {inline.map((policy) => (
            <ExpandableSection key={policy.name} headerText={policy.name}>
              {jsonBlock(policy.document)}
            </ExpandableSection>
          ))}
        </SpaceBetween>
      )}
    </SpaceBetween>
  )
}

function DetailModalShell({
  title,
  loading,
  error,
  onClose,
  children,
}: {
  title: string
  loading: boolean
  error: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Modal visible onDismiss={onClose} header={title} size="large">
      {loading && <StatusIndicator type="loading">Loading</StatusIndicator>}
      {!loading && error && <Alert type="error">{error}</Alert>}
      {!loading && !error && children}
    </Modal>
  )
}

function UserDetailModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchIAMUserDetail(name, activeEndpoint), [name, activeEndpoint])
  const { data, loading, error } = useFetch<IAMUserDetail>(fetcher)

  return (
    <DetailModalShell title={name} loading={loading} error={error} onClose={onClose}>
      {data && (
        <Tabs
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: kvGrid([
                ['User name', data.user.UserName],
                ['User ID', data.user.UserId],
                ['ARN', data.user.Arn],
                ['Path', data.user.Path],
                ['Created', formatDate(data.user.CreateDate)],
                ['Password last used', formatDate(data.user.PasswordLastUsed)],
              ]),
            },
            { id: 'policies', label: 'Policies', content: policiesPanel(data.attached_policies, data.inline_policies) },
            {
              id: 'groups',
              label: `Groups (${data.groups.length})`,
              content:
                data.groups.length === 0 ? (
                  <Box color="text-status-inactive">Not a member of any group</Box>
                ) : (
                  <Table
                    variant="embedded"
                    items={data.groups}
                    trackBy="GroupName"
                    columnDefinitions={[
                      { id: 'name', header: 'Group', cell: (g) => g.GroupName },
                      { id: 'arn', header: 'ARN', cell: (g) => <Box fontSize="body-s">{g.Arn}</Box> },
                    ]}
                  />
                ),
            },
            {
              id: 'keys',
              label: `Access keys (${data.access_keys.length})`,
              content:
                data.access_keys.length === 0 ? (
                  <Box color="text-status-inactive">No access keys</Box>
                ) : (
                  <Table
                    variant="embedded"
                    items={data.access_keys}
                    trackBy="AccessKeyId"
                    columnDefinitions={[
                      { id: 'id', header: 'Access key ID', cell: (k) => k.AccessKeyId },
                      {
                        id: 'status',
                        header: 'Status',
                        cell: (k) => (
                          <StatusIndicator type={k.Status === 'Active' ? 'success' : 'stopped'}>{k.Status}</StatusIndicator>
                        ),
                      },
                      { id: 'created', header: 'Created', cell: (k) => formatDate(k.CreateDate) },
                    ]}
                  />
                ),
            },
            { id: 'tags', label: 'Tags', content: tagsBadges(data.tags) },
          ]}
        />
      )}
    </DetailModalShell>
  )
}

function RoleDetailModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchIAMRoleDetail(name, activeEndpoint), [name, activeEndpoint])
  const { data, loading, error } = useFetch<IAMRoleDetail>(fetcher)

  return (
    <DetailModalShell title={name} loading={loading} error={error} onClose={onClose}>
      {data && (
        <Tabs
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: kvGrid([
                ['Role name', data.role.RoleName],
                ['Role ID', data.role.RoleId],
                ['ARN', data.role.Arn],
                ['Path', data.role.Path],
                ['Created', formatDate(data.role.CreateDate)],
                ['Max session duration', data.role.MaxSessionDuration ? `${data.role.MaxSessionDuration}s` : '—'],
              ]),
            },
            { id: 'trust', label: 'Trust policy', content: jsonBlock(data.trust_policy) },
            { id: 'policies', label: 'Policies', content: policiesPanel(data.attached_policies, data.inline_policies) },
            { id: 'tags', label: 'Tags', content: tagsBadges(data.tags) },
          ]}
        />
      )}
    </DetailModalShell>
  )
}

function GroupDetailModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchIAMGroupDetail(name, activeEndpoint), [name, activeEndpoint])
  const { data, loading, error } = useFetch<IAMGroupDetail>(fetcher)

  return (
    <DetailModalShell title={name} loading={loading} error={error} onClose={onClose}>
      {data && (
        <Tabs
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: kvGrid([
                ['Group name', data.group.GroupName],
                ['Group ID', data.group.GroupId],
                ['ARN', data.group.Arn],
                ['Path', data.group.Path],
                ['Created', formatDate(data.group.CreateDate)],
              ]),
            },
            {
              id: 'users',
              label: `Users (${data.users.length})`,
              content:
                data.users.length === 0 ? (
                  <Box color="text-status-inactive">No members</Box>
                ) : (
                  <Table
                    variant="embedded"
                    items={data.users}
                    trackBy="UserName"
                    columnDefinitions={[
                      { id: 'name', header: 'User', cell: (u) => u.UserName },
                      { id: 'arn', header: 'ARN', cell: (u) => <Box fontSize="body-s">{u.Arn}</Box> },
                    ]}
                  />
                ),
            },
            { id: 'policies', label: 'Policies', content: policiesPanel(data.attached_policies, data.inline_policies) },
          ]}
        />
      )}
    </DetailModalShell>
  )
}

function PolicyDetailModal({ arn, onClose }: { arn: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchIAMPolicyDetail(arn, activeEndpoint), [arn, activeEndpoint])
  const { data, loading, error } = useFetch<IAMPolicyDetail>(fetcher)

  return (
    <DetailModalShell title={data?.policy.PolicyName ?? arn} loading={loading} error={error} onClose={onClose}>
      {data && (
        <Tabs
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: kvGrid([
                ['Policy name', data.policy.PolicyName],
                ['Policy ID', data.policy.PolicyId],
                ['ARN', data.policy.Arn],
                ['Path', data.policy.Path],
                ['Default version', data.policy.DefaultVersionId ?? '—'],
                ['Attachment count', String(data.policy.AttachmentCount)],
                ['Created', formatDate(data.policy.CreateDate)],
                ['Updated', formatDate(data.policy.UpdateDate)],
              ]),
            },
            { id: 'document', label: 'Document', content: jsonBlock(data.document) },
            {
              id: 'attached',
              label: 'Attached to',
              content: (
                <SpaceBetween size="m">
                  {(['users', 'roles', 'groups'] as const).map((kind) => {
                    const entries = data.attached_to[kind]
                    return (
                      <div key={kind}>
                        <Header variant="h3" counter={`(${entries.length})`}>
                          {kind[0].toUpperCase() + kind.slice(1)}
                        </Header>
                        {entries.length === 0 ? (
                          <Box color="text-status-inactive">None</Box>
                        ) : (
                          <SpaceBetween direction="horizontal" size="xs">
                            {entries.map((entry) => {
                              const label = 'UserName' in entry ? entry.UserName : 'RoleName' in entry ? entry.RoleName : entry.GroupName
                              return (
                                <Badge key={label} color="grey">
                                  {label}
                                </Badge>
                              )
                            })}
                          </SpaceBetween>
                        )}
                      </div>
                    )
                  })}
                </SpaceBetween>
              ),
            },
            { id: 'tags', label: 'Tags', content: tagsBadges(data.tags) },
          ]}
        />
      )}
    </DetailModalShell>
  )
}

function EntityTable<T extends object>({
  items,
  loading,
  trackBy,
  columns,
  filterPlaceholder,
  empty,
}: {
  items: T[]
  loading: boolean
  trackBy: keyof T & string
  columns: Array<{ id: string; header: string; cell: (item: T) => React.ReactNode; sortingField?: string }>
  filterPlaceholder: string
  empty: string
}) {
  const { items: pageItems, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(items, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={pageItems}
      trackBy={trackBy}
      loading={loading}
      loadingText="Loading"
      variant="embedded"
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder={filterPlaceholder}
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={<Box textAlign="center">{empty}</Box>}
      columnDefinitions={columns}
    />
  )
}

export function CloudscapeIAMBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const entityType = searchParams.get('type') as EntityType | null
  const entityName = searchParams.get('name')

  const usersFetcher = useCallback(() => fetchIAMUsers(activeEndpoint), [activeEndpoint])
  const groupsFetcher = useCallback(() => fetchIAMGroups(activeEndpoint), [activeEndpoint])
  const rolesFetcher = useCallback(() => fetchIAMRoles(activeEndpoint), [activeEndpoint])
  const policiesFetcher = useCallback(() => fetchIAMPolicies('Local', activeEndpoint), [activeEndpoint])

  const { data: usersData, loading: usersLoading, refresh: refreshUsers } = useFetch<{ users: IAMUser[] }>(usersFetcher, 15000)
  const { data: groupsData, loading: groupsLoading, refresh: refreshGroups } = useFetch<{ groups: IAMGroup[] }>(groupsFetcher, 15000)
  const { data: rolesData, loading: rolesLoading, refresh: refreshRoles } = useFetch<{ roles: IAMRole[] }>(rolesFetcher, 15000)
  const { data: policiesData, loading: policiesLoading, refresh: refreshPolicies } = useFetch<{ policies: IAMPolicy[] }>(
    policiesFetcher,
    15000,
  )

  const openEntity = useCallback(
    (type: EntityType, name: string) => setSearchParams({ type, name }),
    [setSearchParams],
  )
  const closeEntity = useCallback(() => setSearchParams({}), [setSearchParams])

  const entityLink = useCallback(
    (type: EntityType, name: string, label?: string) => (
      <Link
        href={`?type=${type}&name=${encodeURIComponent(name)}`}
        onFollow={(event) => {
          event.preventDefault()
          openEntity(type, name)
        }}
      >
        {label ?? name}
      </Link>
    ),
    [openEntity],
  )

  const refreshAll = useCallback(() => {
    refreshUsers()
    refreshGroups()
    refreshRoles()
    refreshPolicies()
  }, [refreshUsers, refreshGroups, refreshRoles, refreshPolicies])

  const anyLoading = usersLoading || groupsLoading || rolesLoading || policiesLoading

  const tabs = useMemo(
    () => [
      {
        id: 'users',
        label: `Users (${usersData?.users.length ?? 0})`,
        content: (
          <EntityTable
            items={usersData?.users ?? []}
            loading={usersLoading && !usersData}
            trackBy="UserName"
            filterPlaceholder="Find a user"
            empty="No users found"
            columns={[
              { id: 'name', header: 'Name', sortingField: 'UserName', cell: (u: IAMUser) => entityLink('user', u.UserName) },
              { id: 'arn', header: 'ARN', cell: (u: IAMUser) => <Box fontSize="body-s">{u.Arn}</Box> },
              { id: 'created', header: 'Created', sortingField: 'CreateDate', cell: (u: IAMUser) => formatDate(u.CreateDate) },
            ]}
          />
        ),
      },
      {
        id: 'groups',
        label: `Groups (${groupsData?.groups.length ?? 0})`,
        content: (
          <EntityTable
            items={groupsData?.groups ?? []}
            loading={groupsLoading && !groupsData}
            trackBy="GroupName"
            filterPlaceholder="Find a group"
            empty="No groups found"
            columns={[
              { id: 'name', header: 'Name', sortingField: 'GroupName', cell: (g: IAMGroup) => entityLink('group', g.GroupName) },
              { id: 'arn', header: 'ARN', cell: (g: IAMGroup) => <Box fontSize="body-s">{g.Arn}</Box> },
              { id: 'created', header: 'Created', sortingField: 'CreateDate', cell: (g: IAMGroup) => formatDate(g.CreateDate) },
            ]}
          />
        ),
      },
      {
        id: 'roles',
        label: `Roles (${rolesData?.roles.length ?? 0})`,
        content: (
          <EntityTable
            items={rolesData?.roles ?? []}
            loading={rolesLoading && !rolesData}
            trackBy="RoleName"
            filterPlaceholder="Find a role"
            empty="No roles found"
            columns={[
              { id: 'name', header: 'Name', sortingField: 'RoleName', cell: (r: IAMRole) => entityLink('role', r.RoleName) },
              { id: 'arn', header: 'ARN', cell: (r: IAMRole) => <Box fontSize="body-s">{r.Arn}</Box> },
              { id: 'created', header: 'Created', sortingField: 'CreateDate', cell: (r: IAMRole) => formatDate(r.CreateDate) },
            ]}
          />
        ),
      },
      {
        id: 'policies',
        label: `Policies (${policiesData?.policies.length ?? 0})`,
        content: (
          <EntityTable
            items={policiesData?.policies ?? []}
            loading={policiesLoading && !policiesData}
            trackBy="Arn"
            filterPlaceholder="Find a policy"
            empty="No customer-managed policies found"
            columns={[
              { id: 'name', header: 'Name', sortingField: 'PolicyName', cell: (p: IAMPolicy) => entityLink('policy', p.Arn, p.PolicyName) },
              { id: 'arn', header: 'ARN', cell: (p: IAMPolicy) => <Box fontSize="body-s">{p.Arn}</Box> },
              {
                id: 'attachments',
                header: 'Attachments',
                sortingField: 'AttachmentCount',
                cell: (p: IAMPolicy) => p.AttachmentCount,
              },
            ]}
          />
        ),
      },
    ],
    [usersData, usersLoading, groupsData, groupsLoading, rolesData, rolesLoading, policiesData, policiesLoading, entityLink],
  )

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        actions={<Button iconName="refresh" onClick={refreshAll} loading={anyLoading} ariaLabel="Refresh IAM" />}
      >
        Identity and Access Management
      </Header>
      <Tabs tabs={tabs} />

      {entityType === 'user' && entityName && <UserDetailModal name={entityName} onClose={closeEntity} />}
      {entityType === 'group' && entityName && <GroupDetailModal name={entityName} onClose={closeEntity} />}
      {entityType === 'role' && entityName && <RoleDetailModal name={entityName} onClose={closeEntity} />}
      {entityType === 'policy' && entityName && <PolicyDetailModal arn={entityName} onClose={closeEntity} />}
    </SpaceBetween>
  )
}
