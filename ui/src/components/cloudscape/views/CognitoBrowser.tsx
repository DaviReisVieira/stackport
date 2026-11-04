import { useCallback, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Header from '@cloudscape-design/components/header'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import {
  fetchCognitoClients,
  fetchCognitoGroup,
  fetchCognitoGroups,
  fetchCognitoIdentityPool,
  fetchCognitoIdentityPools,
  fetchCognitoUser,
  fetchCognitoUserPool,
  fetchCognitoUserPools,
  fetchCognitoUsers,
} from '@/lib/api'
import type {
  CognitoGroup,
  CognitoGroupDetail,
  CognitoIdentityPool,
  CognitoIdentityPoolDetail,
  CognitoUser,
  CognitoUserDetail,
  CognitoUserPool,
  CognitoUserPoolClient,
  CognitoUserPoolDetail,
} from '@/lib/types'

const EMPTY = '-'

function formatDate(iso?: string | null): string {
  if (!iso) return EMPTY
  return new Date(iso).toLocaleString()
}

function formatBool(value?: boolean | null): string {
  if (value === undefined || value === null) return EMPTY
  return value ? 'Yes' : 'No'
}

function userStatusIndicator(status?: string | null) {
  const types: Record<string, StatusIndicatorProps.Type> = {
    CONFIRMED: 'success',
    UNCONFIRMED: 'pending',
    FORCE_CHANGE_PASSWORD: 'pending',
    RESET_REQUIRED: 'warning',
  }
  const label = status ?? 'UNKNOWN'
  return <StatusIndicator type={types[label] ?? 'info'}>{label}</StatusIndicator>
}

function kvGrid(rows: Array<[string, ReactNode]>) {
  return (
    <ColumnLayout columns={2} variant="text-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <Box variant="awsui-key-label">{label}</Box>
          <div>{value ?? EMPTY}</div>
        </div>
      ))}
    </ColumnLayout>
  )
}

function emptyState(text: string) {
  return (
    <Box textAlign="center" padding="l" color="text-status-inactive">
      {text}
    </Box>
  )
}

function listOrDash(values?: string[] | null) {
  return values && values.length > 0 ? values.join(', ') : EMPTY
}

// --- User pools: users ---

function UserDetailModal({ poolId, username, onClose }: { poolId: string; username: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoUser(poolId, username, activeEndpoint), [poolId, username, activeEndpoint])
  const { data, loading } = useFetch<CognitoUserDetail>(fetcher)
  const attributes = Object.entries(data?.attributes ?? {}).map(([name, value]) => ({ name, value }))

  return (
    <Modal visible onDismiss={onClose} header={username} size="large">
      {loading && !data ? (
        <StatusIndicator type="loading">Loading user</StatusIndicator>
      ) : data ? (
        <SpaceBetween size="l">
          {kvGrid([
            ['Status', userStatusIndicator(data.status)],
            ['Enabled', formatBool(data.enabled)],
            ['Created', formatDate(data.created)],
            ['Last modified', formatDate(data.modified)],
          ])}
          <Table
            items={attributes}
            trackBy="name"
            variant="embedded"
            header={<Header variant="h3">Attributes</Header>}
            empty={emptyState('No attributes')}
            columnDefinitions={[
              { id: 'name', header: 'Name', cell: (a) => a.name },
              { id: 'value', header: 'Value', cell: (a) => a.value },
            ]}
          />
          <SpaceBetween size="xs">
            <Header variant="h3">Groups</Header>
            {data.groups.length > 0 ? (
              <SpaceBetween direction="horizontal" size="xs">
                {data.groups.map((group) => (
                  <Badge key={group} color="blue">
                    {group}
                  </Badge>
                ))}
              </SpaceBetween>
            ) : (
              <Box color="text-status-inactive">Not in any group</Box>
            )}
          </SpaceBetween>
        </SpaceBetween>
      ) : null}
    </Modal>
  )
}

function UsersPanel({ poolId }: { poolId: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoUsers(poolId, activeEndpoint), [poolId, activeEndpoint])
  const { data, loading } = useFetch<{ users: CognitoUser[] }>(fetcher, 15000)
  const [selected, setSelected] = useState<string | null>(null)

  const { items, collectionProps, paginationProps } = useCollection(data?.users ?? [], {
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <>
      <Table
        {...collectionProps}
        items={items}
        trackBy="username"
        variant="embedded"
        loading={loading && !data}
        loadingText="Loading users"
        empty={emptyState('No users in this pool')}
        onRowClick={({ detail }) => setSelected(detail.item.username)}
        columnDefinitions={[
          {
            id: 'username',
            header: 'Username',
            sortingField: 'username',
            cell: (u) => (
              <Link
                href="#"
                onFollow={(event) => {
                  event.preventDefault()
                  setSelected(u.username)
                }}
              >
                {u.username}
              </Link>
            ),
          },
          { id: 'status', header: 'Status', sortingField: 'status', cell: (u) => userStatusIndicator(u.status) },
          { id: 'email', header: 'Email', cell: (u) => u.attributes.email ?? EMPTY },
          { id: 'enabled', header: 'Enabled', cell: (u) => formatBool(u.enabled) },
          { id: 'created', header: 'Created', sortingField: 'created', cell: (u) => formatDate(u.created) },
        ]}
        pagination={<Pagination {...paginationProps} />}
      />
      {selected && <UserDetailModal poolId={poolId} username={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

// --- User pools: groups and app clients ---

function GroupDetailModal({ poolId, name, onClose }: { poolId: string; name: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoGroup(poolId, name, activeEndpoint), [poolId, name, activeEndpoint])
  const { data, loading, error } = useFetch<CognitoGroupDetail>(fetcher)

  return (
    <Modal visible onDismiss={onClose} header={name} size="large">
      {loading && !data ? (
        <StatusIndicator type="loading">Loading group</StatusIndicator>
      ) : error && !data ? (
        <Alert type="error" header="Could not load group">
          {error}
        </Alert>
      ) : data ? (
        <SpaceBetween size="l">
          {kvGrid([
            ['Description', data.description || EMPTY],
            ['Precedence', data.precedence ?? EMPTY],
            ['Role ARN', data.roleArn ?? EMPTY],
            ['Created', formatDate(data.created)],
            ['Last modified', formatDate(data.modified)],
          ])}
          <Table
            items={data.members}
            trackBy="username"
            variant="embedded"
            header={<Header variant="h3" counter={`(${data.members.length})`}>Members</Header>}
            empty={emptyState('No users in this group')}
            columnDefinitions={[
              { id: 'username', header: 'Username', cell: (m) => m.username },
              { id: 'status', header: 'Status', cell: (m) => userStatusIndicator(m.status) },
              { id: 'email', header: 'Email', cell: (m) => m.email ?? EMPTY },
              { id: 'enabled', header: 'Enabled', cell: (m) => formatBool(m.enabled) },
            ]}
          />
        </SpaceBetween>
      ) : null}
    </Modal>
  )
}

function GroupsPanel({ poolId }: { poolId: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoGroups(poolId, activeEndpoint), [poolId, activeEndpoint])
  const { data, loading } = useFetch<{ groups: CognitoGroup[] }>(fetcher)
  const [selected, setSelected] = useState<string | null>(null)

  const { items, collectionProps, paginationProps } = useCollection(data?.groups ?? [], {
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <>
      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        variant="embedded"
        loading={loading && !data}
        loadingText="Loading groups"
        empty={emptyState('No groups in this pool')}
        onRowClick={({ detail }) => setSelected(detail.item.name)}
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (g) => (
              <Link
                href="#"
                onFollow={(event) => {
                  event.preventDefault()
                  setSelected(g.name)
                }}
              >
                {g.name}
              </Link>
            ),
          },
          { id: 'description', header: 'Description', cell: (g) => g.description || EMPTY },
          { id: 'precedence', header: 'Precedence', sortingField: 'precedence', cell: (g) => g.precedence ?? EMPTY },
          { id: 'role', header: 'Role ARN', cell: (g) => g.roleArn ?? EMPTY },
        ]}
        pagination={<Pagination {...paginationProps} />}
      />
      {selected && <GroupDetailModal poolId={poolId} name={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function tokenValidity(client: CognitoUserPoolClient): string {
  const { accessToken, idToken, refreshToken, units } = client.tokenValidity
  // Never guess a unit: emulators often omit TokenValidityUnits and the AWS defaults differ per token.
  const part = (label: string, value?: number | null, unit?: string) =>
    value === undefined || value === null ? null : `${label} ${value} ${unit || '(unit not reported)'}`
  const parts = [
    part('Access', accessToken, units?.AccessToken),
    part('ID', idToken, units?.IdToken),
    part('Refresh', refreshToken, units?.RefreshToken),
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(', ') : EMPTY
}

function ClientsPanel({ poolId }: { poolId: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoClients(poolId, activeEndpoint), [poolId, activeEndpoint])
  const { data, loading } = useFetch<{ clients: CognitoUserPoolClient[] }>(fetcher)

  const { items, collectionProps, paginationProps } = useCollection(data?.clients ?? [], {
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="clientId"
      variant="embedded"
      loading={loading && !data}
      loadingText="Loading app clients"
      empty={emptyState('No app clients in this pool')}
      columnDefinitions={[
        { id: 'name', header: 'Name', sortingField: 'clientName', cell: (c) => c.clientName ?? EMPTY },
        { id: 'id', header: 'Client ID', cell: (c) => c.clientId },
        { id: 'authFlows', header: 'Auth flows', cell: (c) => listOrDash(c.explicitAuthFlows) },
        { id: 'oauthFlows', header: 'OAuth flows', cell: (c) => listOrDash(c.allowedOAuthFlows) },
        { id: 'callbacks', header: 'Callback URLs', cell: (c) => listOrDash(c.callbackURLs) },
        { id: 'tokens', header: 'Token validity', cell: (c) => tokenValidity(c) },
      ]}
      pagination={<Pagination {...paginationProps} />}
    />
  )
}

// --- User pools: configuration ---

function ConfigurationPanel({ pool }: { pool: CognitoUserPoolDetail }) {
  const policy = pool.Policies?.PasswordPolicy
  const triggers = Object.entries(pool.LambdaConfig ?? {}).map(([trigger, value]) => ({
    trigger,
    target: typeof value === 'string' ? value : value.LambdaArn ?? JSON.stringify(value),
  }))

  return (
    <SpaceBetween size="l">
      {kvGrid([
        ['Estimated users', pool.EstimatedNumberOfUsers ?? EMPTY],
        ['MFA', pool.MfaConfiguration ?? EMPTY],
        ['Created', formatDate(pool.CreationDate)],
        ['Last modified', formatDate(pool.LastModifiedDate)],
      ])}
      <SpaceBetween size="xs">
        <Header variant="h3">Password policy</Header>
        {policy ? (
          kvGrid([
            ['Minimum length', policy.MinimumLength ?? EMPTY],
            ['Require uppercase', formatBool(policy.RequireUppercase)],
            ['Require lowercase', formatBool(policy.RequireLowercase)],
            ['Require numbers', formatBool(policy.RequireNumbers)],
            ['Require symbols', formatBool(policy.RequireSymbols)],
            ['Temporary password validity (days)', policy.TemporaryPasswordValidityDays ?? EMPTY],
          ])
        ) : (
          <Box color="text-status-inactive">No password policy</Box>
        )}
      </SpaceBetween>
      <Table
        items={pool.SchemaAttributes ?? []}
        trackBy="Name"
        variant="embedded"
        header={<Header variant="h3">Schema attributes</Header>}
        empty={emptyState('No schema attributes')}
        columnDefinitions={[
          { id: 'name', header: 'Name', cell: (a) => a.Name ?? EMPTY },
          { id: 'type', header: 'Type', cell: (a) => a.AttributeDataType ?? EMPTY },
          { id: 'required', header: 'Required', cell: (a) => formatBool(a.Required) },
          { id: 'mutable', header: 'Mutable', cell: (a) => formatBool(a.Mutable) },
        ]}
      />
      <Table
        items={triggers}
        trackBy="trigger"
        variant="embedded"
        header={<Header variant="h3">Lambda triggers</Header>}
        empty={emptyState('No Lambda triggers')}
        columnDefinitions={[
          { id: 'trigger', header: 'Trigger', cell: (t) => t.trigger },
          { id: 'target', header: 'Target', cell: (t) => t.target },
        ]}
      />
    </SpaceBetween>
  )
}

function UserPoolDetailView({ poolId, onBack }: { poolId: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoUserPool(poolId, activeEndpoint), [poolId, activeEndpoint])
  const { data: pool, loading, error, refresh } = useFetch<CognitoUserPoolDetail>(fetcher)

  if (loading && !pool) return <StatusIndicator type="loading">Loading user pool</StatusIndicator>
  if (error && !pool) {
    return (
      <Alert
        type="error"
        header="Could not load user pool"
        action={<Button onClick={onBack}>Back to user pools</Button>}
      >
        {error}
      </Alert>
    )
  }
  if (!pool) return null

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description={pool.Id}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to user pools</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh user pool" />
          </SpaceBetween>
        }
      >
        {pool.Name}
      </Header>
      <Tabs
        tabs={[
          { id: 'users', label: 'Users', content: <UsersPanel poolId={poolId} /> },
          { id: 'groups', label: 'Groups', content: <GroupsPanel poolId={poolId} /> },
          { id: 'clients', label: 'App clients', content: <ClientsPanel poolId={poolId} /> },
          { id: 'configuration', label: 'Configuration', content: <ConfigurationPanel pool={pool} /> },
        ]}
      />
    </SpaceBetween>
  )
}

export function CloudscapeCognitoUserPoolsBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedPool = searchParams.get('pool')
  const fetcher = useCallback(() => fetchCognitoUserPools(activeEndpoint), [activeEndpoint])
  const { data, loading, refresh } = useFetch<{ userPools: CognitoUserPool[] }>(fetcher, 15000)
  const pools = data?.userPools ?? []

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(pools, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const backToList = useCallback(() => setSearchParams({}), [setSearchParams])

  if (selectedPool) return <UserPoolDetailView poolId={selectedPool} onBack={backToList} />

  return (
    <Table
      {...collectionProps}
      items={items}
      trackBy="id"
      variant="borderless"
      loading={loading && !data}
      loadingText="Loading user pools"
      empty={emptyState('No user pools exist yet')}
      header={
        <Header
          counter={`(${pools.length})`}
          actions={<Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh user pools" />}
        >
          User pools
        </Header>
      }
      columnDefinitions={[
        {
          id: 'name',
          header: 'Name',
          sortingField: 'name',
          cell: (p) => (
            <Link
              href={`?pool=${encodeURIComponent(p.id)}`}
              onFollow={(event) => {
                event.preventDefault()
                setSearchParams({ pool: p.id })
              }}
            >
              {p.name}
            </Link>
          ),
        },
        { id: 'id', header: 'Pool ID', sortingField: 'id', cell: (p) => p.id },
        {
          id: 'estimatedUsers',
          header: 'Estimated users',
          sortingField: 'estimatedNumberOfUsers',
          cell: (p) => p.estimatedNumberOfUsers ?? EMPTY,
        },
        { id: 'created', header: 'Created', sortingField: 'creationDate', cell: (p) => formatDate(p.creationDate) },
      ]}
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Find user pools"
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
      pagination={<Pagination {...paginationProps} />}
    />
  )
}

// --- Identity pools ---

function IdentityPoolDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchCognitoIdentityPool(id, activeEndpoint), [id, activeEndpoint])
  const { data, loading } = useFetch<CognitoIdentityPoolDetail>(fetcher)
  const loginProviders = Object.entries(data?.SupportedLoginProviders ?? {}).map(([provider, appId]) => ({
    provider,
    appId,
  }))

  return (
    <Modal visible onDismiss={onClose} header={data?.IdentityPoolName ?? id} size="large">
      {loading && !data ? (
        <StatusIndicator type="loading">Loading identity pool</StatusIndicator>
      ) : data ? (
        <SpaceBetween size="l">
          {kvGrid([
            ['Identity pool ID', data.IdentityPoolId],
            ['Unauthenticated access', formatBool(data.AllowUnauthenticatedIdentities)],
          ])}
          <Table
            items={data.CognitoIdentityProviders ?? []}
            trackBy={(p) => `${p.ProviderName ?? ''}|${p.ClientId ?? ''}`}
            variant="embedded"
            header={<Header variant="h3">Cognito providers</Header>}
            empty={emptyState('No Cognito providers')}
            columnDefinitions={[
              { id: 'provider', header: 'Provider name', cell: (p) => p.ProviderName ?? EMPTY },
              { id: 'client', header: 'Client ID', cell: (p) => p.ClientId ?? EMPTY },
              { id: 'check', header: 'Server-side token check', cell: (p) => formatBool(p.ServerSideTokenCheck) },
            ]}
          />
          <Table
            items={loginProviders}
            trackBy="provider"
            variant="embedded"
            header={<Header variant="h3">Supported login providers</Header>}
            empty={emptyState('No supported login providers')}
            columnDefinitions={[
              { id: 'provider', header: 'Provider', cell: (p) => p.provider },
              { id: 'appId', header: 'App ID', cell: (p) => p.appId },
            ]}
          />
        </SpaceBetween>
      ) : null}
    </Modal>
  )
}

export function CloudscapeCognitoIdentityPoolsBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedPool = searchParams.get('pool')
  const fetcher = useCallback(() => fetchCognitoIdentityPools(activeEndpoint), [activeEndpoint])
  const { data, loading, refresh } = useFetch<{ identityPools: CognitoIdentityPool[] }>(fetcher, 15000)
  const pools = data?.identityPools ?? []

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(pools, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openPool = useCallback((id: string) => setSearchParams({ pool: id }), [setSearchParams])
  const closeModal = useCallback(() => setSearchParams({}), [setSearchParams])

  return (
    <SpaceBetween size="l">
      <Table
        {...collectionProps}
        items={items}
        trackBy="id"
        variant="borderless"
        loading={loading && !data}
        loadingText="Loading identity pools"
        empty={emptyState('No identity pools exist yet')}
        onRowClick={({ detail }) => openPool(detail.item.id)}
        header={
          <Header
            counter={`(${pools.length})`}
            actions={
              <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh identity pools" />
            }
          >
            Identity pools
          </Header>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (p) => (
              <Link
                href={`?pool=${encodeURIComponent(p.id)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openPool(p.id)
                }}
              >
                {p.name}
              </Link>
            ),
          },
          { id: 'id', header: 'Identity pool ID', sortingField: 'id', cell: (p) => p.id },
        ]}
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find identity pools"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
      />
      {selectedPool && <IdentityPoolDetailModal id={selectedPool} onClose={closeModal} />}
    </SpaceBetween>
  )
}
