import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { exportData } from '@/lib/export'

vi.mock('@/lib/export', () => ({ exportData: vi.fn() }))
const healthState = vi.hoisted(() => ({ writesEnabled: true }))

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints: [],
    loading: false,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    data: {
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      endpoint_url: 'http://localhost:4566',
      region: 'us-east-1',
      services_count: 2,
      connection_type: 'local',
      writes_enabled: healthState.writesEnabled,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

import CloudscapeResourceBrowser from '@/pages/CloudscapeResourceBrowser'

const statsPayload = {
  services: {
    'cognito-idp': { status: 'available', resources: { user_pools: 1 } },
    'cognito-identity': { status: 'available', resources: { identity_pools: 1 } },
  },
  total_resources: 2,
  uptime_seconds: 60,
}

const ISO = '2024-02-01T00:00:00+00:00'
const POOL_ID = 'us-east-1_abc'
const IDENTITY_POOL_ID = 'us-east-1:1111-2222'

const userPool = { id: POOL_ID, name: 'main-pool', estimatedNumberOfUsers: 7, creationDate: ISO, lastModifiedDate: ISO }
const otherPool = { id: 'us-east-1_other', name: 'other-pool', estimatedNumberOfUsers: null, creationDate: ISO, lastModifiedDate: ISO }
const userPoolDetail = {
  Id: POOL_ID,
  Name: 'main-pool',
  EstimatedNumberOfUsers: 1,
  MfaConfiguration: 'OFF',
  Policies: { PasswordPolicy: { MinimumLength: 8, RequireUppercase: true } },
  SchemaAttributes: [{ Name: 'email', AttributeDataType: 'String', Required: false, Mutable: true }],
  LambdaConfig: {
    PreSignUp: 'arn:aws:lambda:us-east-1:000000000000:function:pre-signup',
    KMSKeyID: 'arn:aws:kms:us-east-1:000000000000:key/key-1',
  },
  UserPoolTags: { environment: 'dev' },
}
const user = {
  username: 'alice',
  status: 'CONFIRMED',
  enabled: true,
  created: ISO,
  modified: ISO,
  attributes: { email: 'alice@example.com', sub: 'sub-123' },
}
const userDetail = { ...user, attributes: { ...user.attributes, given_name: 'Alice' }, groups: ['admins'] }
const group = { name: 'admins', description: 'Administrators', precedence: 1, roleArn: null }
const emptyGroup = { name: 'night shift/ops', description: 'Nobody yet', precedence: 5, roleArn: null }
const groupDetail = {
  ...group,
  created: ISO,
  modified: ISO,
  members: [
    { username: 'alice', status: 'CONFIRMED', enabled: true, email: 'alice@example.com' },
    { username: 'bob', status: 'UNCONFIRMED', enabled: false, email: null },
  ],
}
const emptyGroupDetail = { ...emptyGroup, created: ISO, modified: ISO, members: [] }
const appClient = {
  clientId: 'client-1',
  clientName: 'web-app',
  detailsAvailable: true,
  hasSecret: true,
  explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH'],
  allowedOAuthFlows: [],
  callbackURLs: [],
  tokenValidity: { accessToken: 60, idToken: null, refreshToken: 30, units: { AccessToken: 'minutes', RefreshToken: 'days' } },
}
const bareClient = {
  clientId: 'client-2',
  clientName: 'cli-app',
  detailsAvailable: true,
  hasSecret: false,
  explicitAuthFlows: [],
  allowedOAuthFlows: [],
  callbackURLs: [],
  tokenValidity: { accessToken: 60, idToken: null, refreshToken: 30, units: null },
}
const identityPool = { id: IDENTITY_POOL_ID, name: 'ids-pool' }
const identityPoolDetail = {
  IdentityPoolId: IDENTITY_POOL_ID,
  IdentityPoolName: 'ids-pool',
  AllowUnauthenticatedIdentities: true,
  CognitoIdentityProviders: [{ ProviderName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_abc', ClientId: 'client-1' }],
  SupportedLoginProviders: { 'accounts.google.com': 'google-app-id' },
  roles: { authenticated: 'arn:aws:iam::000000000000:role/Cognito_Auth' },
  roleMappings: {
    'cognito-idp.us-east-1.amazonaws.com/us-east-1_abc:client-1': {
      Type: 'Rules',
      AmbiguousRoleResolution: 'AuthenticatedRole',
      RulesConfiguration: {
        Rules: [
          { Claim: 'cognito:groups', MatchType: 'Contains', Value: 'admins', RoleARN: 'arn:aws:iam::000000000000:role/Admin' },
        ],
      },
    },
  },
}
const bareIdentityPool = { id: 'us-east-1:bare', name: 'bare-pool' }
const bareIdentityPoolDetail = {
  IdentityPoolId: 'us-east-1:bare',
  IdentityPoolName: 'bare-pool',
  AllowUnauthenticatedIdentities: false,
  roles: {},
  roleMappings: {},
}

let requested: string[] = []

/** Per-test responses matched by URL substring before the defaults. A null payload means 404. */
function mockFetchByUrl(overrides: Record<string, unknown> = {}) {
  requested = []
  let tags = { ...userPoolDetail.UserPoolTags }
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requested.push(url)
    const override = Object.keys(overrides).find((key) => url.includes(key))
    if (override !== undefined) {
      const body = overrides[override]
      if (body instanceof Response) return Promise.resolve(body.clone())
      if (body === null) {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({}) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }
    let payload: unknown = statsPayload
    if (url.includes(`/api/tags/cognito-idp/user_pools/${POOL_ID}`)) {
      if (init?.method === 'PUT') tags = JSON.parse(String(init.body)).tags
      payload = { tags }
    }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/users/alice`)) payload = userDetail
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/users`)) payload = { users: [user] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/groups/admins`)) payload = groupDetail
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/groups/${encodeURIComponent(emptyGroup.name)}`))
      payload = emptyGroupDetail
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/groups`)) payload = { groups: [group, emptyGroup] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/clients`)) payload = { clients: [appClient, bareClient] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}`)) payload = userPoolDetail
    else if (url.includes('/api/cognito/user-pools')) payload = { userPools: [userPool, otherPool] }
    else if (url.includes(`/api/cognito/identity-pools/${encodeURIComponent(IDENTITY_POOL_ID)}`)) payload = identityPoolDetail
    else if (url.includes(`/api/cognito/identity-pools/${encodeURIComponent('us-east-1:bare')}`))
      payload = bareIdentityPoolDetail
    else if (url.includes('/api/cognito/identity-pools')) payload = { identityPools: [identityPool, bareIdentityPool] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  }) as unknown as typeof fetch
}

function BrowserBack() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>Browser back</button>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BrowserBack />
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  healthState.writesEnabled = true
  localStorage.clear()
  mockFetchByUrl()
})

function unsupportedResponse() {
  return new Response(JSON.stringify({
    detail: 'Not supported by this endpoint',
    error: { kind: 'not_implemented', message: 'Not supported by this endpoint', hint: 'Try a different endpoint.', cause: 'UnknownOperationException' },
  }), { status: 501 })
}

describe('Cognito list errors', () => {
  it.each([
    { path: '/resources/cognito-idp', api: '/api/cognito/user-pools', empty: 'No user pools exist yet' },
    { path: '/resources/cognito-identity', api: '/api/cognito/identity-pools', empty: 'No identity pools exist yet' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, api: `/api/cognito/user-pools/${POOL_ID}/users`, empty: 'No users in this pool' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, api: `/api/cognito/user-pools/${POOL_ID}/groups`, empty: 'No groups in this pool', tab: 'Groups' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, api: `/api/cognito/user-pools/${POOL_ID}/clients`, empty: 'No app clients in this pool', tab: 'App clients' },
  ])('shows a classified alert and retries $api', async ({ path, api, empty, tab }) => {
    const overrides: Record<string, unknown> = { [api]: unsupportedResponse() }
    mockFetchByUrl(overrides)
    renderAt(path)
    if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }))
    expect(await screen.findByText('Not supported by this endpoint')).toBeInTheDocument()
    expect(screen.getByText('Try a different endpoint.')).toBeInTheDocument()
    expect(screen.queryByText(empty)).not.toBeInTheDocument()
    const calls = requested.filter((url) => url.includes(api)).length
    delete overrides[api]
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Not supported by this endpoint')).not.toBeInTheDocument())
    expect(requested.filter((url) => url.includes(api)).length).toBe(calls + 1)
  })

  it('keeps the previous data visible when a refresh fails', async () => {
    const overrides: Record<string, unknown> = {}
    mockFetchByUrl(overrides)
    renderAt('/resources/cognito-idp')
    expect(await screen.findByText('main-pool')).toBeInTheDocument()
    overrides['/api/cognito/user-pools'] = unsupportedResponse()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh user pools' }))
    expect(await screen.findByText('Not supported by this endpoint')).toBeInTheDocument()
    expect(screen.getByText('main-pool')).toBeInTheDocument()
  })
})

describe('Cognito pool filter empty states', () => {
  it.each([
    { service: 'cognito-idp', label: 'user pools', pool: 'main-pool' },
    { service: 'cognito-identity', label: 'identity pools', pool: 'ids-pool' },
  ])('distinguishes no matches from no $label', async ({ service, label, pool }) => {
    renderAt(`/resources/${service}`)
    expect(await screen.findByText(pool)).toBeInTheDocument()
    const filter = screen.getByPlaceholderText(`Find ${label}`)
    fireEvent.change(filter, { target: { value: 'no-such-pool' } })
    expect(screen.getByText(`No matching ${label}`)).toBeInTheDocument()
    expect(screen.queryByText(`No ${label} exist yet`)).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: '' } })
    expect(screen.getByText(pool)).toBeInTheDocument()
  })

  it.each([
    { service: 'cognito-idp', api: '/api/cognito/user-pools', payload: { userPools: [] }, label: 'user pools' },
    { service: 'cognito-identity', api: '/api/cognito/identity-pools', payload: { identityPools: [] }, label: 'identity pools' },
  ])('keeps the empty state when no $label exist', async ({ service, api, payload, label }) => {
    mockFetchByUrl({ [api]: payload })
    renderAt(`/resources/${service}`)
    expect(await screen.findByText(`No ${label} exist yet`)).toBeInTheDocument()
    expect(screen.queryByText(`No matching ${label}`)).not.toBeInTheDocument()
  })
})

describe('Cognito list exports', () => {
  it.each([
    { path: '/resources/cognito-idp', service: 'cognito-idp', resourceType: 'user_pools', data: [userPool, otherPool], ready: 'main-pool' },
    { path: '/resources/cognito-identity', service: 'cognito-identity', resourceType: 'identity_pools', data: [identityPool, bareIdentityPool], ready: 'ids-pool' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, service: 'cognito-idp', resourceType: 'users', data: [user], ready: 'alice' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, service: 'cognito-idp', resourceType: 'groups', data: [group, emptyGroup], ready: 'admins', tab: 'Groups' },
    { path: `/resources/cognito-idp?pool=${POOL_ID}`, service: 'cognito-idp', resourceType: 'app_clients', data: [appClient, bareClient], ready: 'web-app', tab: 'App clients' },
  ])('exports $resourceType to JSON and CSV', async ({ path, service, resourceType, data, ready, tab }) => {
    renderAt(path)
    if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }))
    expect(await screen.findByText(ready)).toBeInTheDocument()
    for (const [label, format] of [['Export JSON', 'json'], ['Export CSV', 'csv']]) {
      fireEvent.click(screen.getByRole('button', { name: /Export/ }))
      fireEvent.click(await screen.findByRole('menuitem', { name: label }))
      expect(exportData).toHaveBeenLastCalledWith({ service, resourceType, data, format })
    }
  })
})

describe('CloudscapeCognitoUserPoolsBrowser (via registry dispatch)', () => {
  it('lists user pools', async () => {
    renderAt('/resources/cognito-idp')
    expect(await screen.findByText('User pools')).toBeInTheDocument()
    expect(await screen.findByText('main-pool')).toBeInTheDocument()
    expect(screen.getByText(POOL_ID)).toBeInTheDocument()
  })

  it('shows estimated users per pool and a dash when unknown', async () => {
    renderAt('/resources/cognito-idp')
    expect(await screen.findByText('Estimated users')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^Status/ })).not.toBeInTheDocument()
    const mainRow = (await screen.findByText('main-pool')).closest('tr') as HTMLElement
    expect(within(mainRow).getByText('7')).toBeInTheDocument()
    const otherRow = screen.getByText('other-pool').closest('tr') as HTMLElement
    expect(within(otherRow).getByText('-')).toBeInTheDocument()
  })

  it('selects a pool, shows users with a status badge and opens the user modal', async () => {
    renderAt('/resources/cognito-idp')
    fireEvent.click(await screen.findByText('main-pool'))

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument()
    expect(requested.some((u) => u.includes(`/api/cognito/user-pools/${POOL_ID}/users`))).toBe(true)

    fireEvent.click(screen.getByText('alice'))
    const dialog = await screen.findByRole('dialog', { name: 'alice' })
    expect(await within(dialog).findByText('given_name')).toBeInTheDocument()
    expect(within(dialog).getByText('Alice')).toBeInTheDocument()
    expect(within(dialog).getByText('sub-123')).toBeInTheDocument()
    expect(within(dialog).getByText('admins')).toBeInTheDocument()
    expect(requested.some((u) => u.includes(`/api/cognito/user-pools/${POOL_ID}/users/alice`))).toBe(true)
  })

  it('shows a message when the user groups could not be loaded', async () => {
    mockFetchByUrl({ [`/api/cognito/user-pools/${POOL_ID}/users/alice`]: { ...userDetail, groups: null } })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByText('alice'))
    const dialog = await screen.findByRole('dialog', { name: 'alice' })
    expect(await within(dialog).findByText('Could not load groups')).toBeInTheDocument()
    expect(within(dialog).queryByText('Not in any group')).not.toBeInTheDocument()
  })

  it('shows an error in the user modal when the user cannot be loaded', async () => {
    mockFetchByUrl({ [`/api/cognito/user-pools/${POOL_ID}/users/alice`]: null })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByText('alice'))
    const dialog = await screen.findByRole('dialog', { name: 'alice' })
    expect(await within(dialog).findByText('Could not load user')).toBeInTheDocument()
    expect(within(dialog).getByText('404: Not Found')).toBeInTheDocument()
  })

  it('shows groups, app clients and configuration tabs', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)

    fireEvent.click(await screen.findByText('Groups'))
    expect(await screen.findByText('Administrators')).toBeInTheDocument()

    fireEvent.click(screen.getByText('App clients'))
    expect(await screen.findByText('web-app')).toBeInTheDocument()
    expect(screen.getByText('ALLOW_USER_PASSWORD_AUTH')).toBeInTheDocument()
    expect(screen.getByText('Access 60 minutes, Refresh 30 days')).toBeInTheDocument()
    expect(screen.getByText('Access 60 (unit not reported), Refresh 30 (unit not reported)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Configuration'))
    expect(await screen.findByText('Password policy')).toBeInTheDocument()
    expect(screen.getByText('PreSignUp')).toBeInTheDocument()
    expect(screen.getByText('OFF')).toBeInTheDocument()
  })

  it.each([
    { tab: 'Users', api: 'users', ready: 'alice', payload: { users: [{ ...user, username: 'new-user' }] }, added: 'new-user' },
    { tab: 'Groups', api: 'groups', ready: 'admins', payload: { groups: [{ ...group, name: 'new-group' }] }, added: 'new-group' },
    { tab: 'App clients', api: 'clients', ready: 'web-app', payload: { clients: [{ ...appClient, clientName: 'new-client' }] }, added: 'new-client' },
  ])('refreshes the pool and active $tab without switching tabs', async ({ tab, api, ready, payload, added }) => {
    const overrides: Record<string, unknown> = {}
    mockFetchByUrl(overrides)
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: tab }))
    expect(await screen.findByText(ready)).toBeInTheDocument()
    overrides[`/api/cognito/user-pools/${POOL_ID}/${api}`] = payload
    const before = requested.filter((url) => url.includes(`/api/cognito/user-pools/${POOL_ID}?`)).length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh user pool' }))
    expect(await screen.findByText(added)).toBeInTheDocument()
    expect(requested.filter((url) => url.includes(`/api/cognito/user-pools/${POOL_ID}?`)).length).toBe(before + 1)
  })

  it('filters users by attributes as well as username', async () => {
    mockFetchByUrl({ [`/api/cognito/user-pools/${POOL_ID}/users`]: { users: [user, { ...user, username: 'bob', attributes: { email: 'bob@example.com' } }] } })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    expect(await screen.findByText('bob')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find users'), { target: { value: 'ALICE@' } })
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.queryByText('bob')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Find users'), { target: { value: 'nobody' } })
    expect(screen.getByText('No matching users')).toBeInTheDocument()
    expect(screen.queryByText('No users in this pool')).not.toBeInTheDocument()
  })

  it('shows secret presence and unavailable client details without inventing values', async () => {
    mockFetchByUrl({ [`/api/cognito/user-pools/${POOL_ID}/clients`]: { clients: [
      appClient, bareClient, { ...bareClient, clientId: 'missing', clientName: 'unavailable', detailsAvailable: false, hasSecret: null, tokenValidity: {} },
    ] } })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'App clients' }))
    const secretRow = (await screen.findByText('web-app')).closest('tr') as HTMLElement
    expect(within(secretRow).getByText('Yes')).toBeInTheDocument()
    expect(within(screen.getByText('cli-app').closest('tr') as HTMLElement).getByText('No')).toBeInTheDocument()
    expect(within(screen.getByText('unavailable').closest('tr') as HTMLElement).getByText('Could not load details')).toBeInTheDocument()
  })

  it('shows group metadata when the members call fails', async () => {
    mockFetchByUrl({ [`/api/cognito/user-pools/${POOL_ID}/groups/admins`]: { ...groupDetail, members: null } })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Groups' }))
    fireEvent.click(await screen.findByText('admins'))
    const dialog = await screen.findByRole('dialog', { name: 'admins' })
    expect(await within(dialog).findByText('Could not load members')).toBeInTheDocument()
    expect(within(dialog).getByText('Administrators')).toBeInTheDocument()
    expect(within(dialog).queryByText('No users in this group')).not.toBeInTheDocument()
  })

  it('separates the trigger KMS key from Lambda triggers and edits pool tags', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeEnabled()
    expect(screen.queryByText('KMSKeyID')).not.toBeInTheDocument()
    expect(screen.getByText(userPoolDetail.LambdaConfig.KMSKeyID)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag value 1' }), { target: { value: 'staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/tags/cognito-idp/user_pools/${POOL_ID}?endpoint=local`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ tags: { environment: 'staging' } }) }),
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled())
    expect(screen.getByDisplayValue('staging')).toBeInTheDocument()
  })

  it('keeps saved tags after a failed reload and adopts the next successful response', async () => {
    const defaultFetch = globalThis.fetch
    let saved = false
    let failReload = true
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(`/api/tags/cognito-idp/user_pools/${POOL_ID}`)) {
        if (init?.method === 'PUT') {
          const response = await defaultFetch(input, init)
          saved = true
          return response
        }
        if (saved) {
          return failReload ? unsupportedResponse() : new Response(JSON.stringify({ tags: { environment: 'confirmed' } }))
        }
      }
      return defaultFetch(input, init)
    }) as typeof fetch
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag value 1' }), { target: { value: 'staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    expect(await screen.findByText('Try a different endpoint.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('staging')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('dev')).not.toBeInTheDocument()

    failReload = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByDisplayValue('confirmed')).toBeEnabled()
    expect(screen.queryByDisplayValue('staging')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled()
  })

  it('retains tag edits after a failed save and lets the user retry', async () => {
    const overrides: Record<string, unknown> = {}
    const tagsPath = `/api/tags/cognito-idp/user_pools/${POOL_ID}`
    mockFetchByUrl(overrides)
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag value 1' }), { target: { value: 'staging' } })
    overrides[tagsPath] = new Response(JSON.stringify({ detail: 'Could not save tags' }), { status: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tags' })).toBeEnabled())
    expect(screen.getByDisplayValue('staging')).toBeEnabled()
    expect(requested.filter((url) => url.includes(tagsPath))).toHaveLength(2)

    delete overrides[tagsPath]
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled())
    expect(screen.getByDisplayValue('staging')).toBeInTheDocument()
    expect(requested.filter((url) => url.includes(tagsPath))).toHaveLength(4)
  })

  it('sends added tags and removes deleted tags from the save payload', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag key 2' }), { target: { value: 'team' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag value 2' }), { target: { value: 'platform' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.queryByDisplayValue('environment')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/tags/cognito-idp/user_pools/${POOL_ID}?endpoint=local`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ tags: { team: 'platform' } }) }),
    ))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled())
    expect(screen.getByDisplayValue('platform')).toBeInTheDocument()
  })

  it('saves an empty tag map when the last tag is removed', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/tags/cognito-idp/user_pools/${POOL_ID}?endpoint=local`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ tags: {} }) }),
    ))
    expect(await screen.findByText('No tags')).toBeInTheDocument()
  })

  it('keeps tags visible but disables editing in read-only mode', async () => {
    healthState.writesEnabled = false
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByDisplayValue('dev')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add tag' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled()
  })

  it('does not allow tag edits after a failed tag lookup', async () => {
    mockFetchByUrl({ [`/api/tags/cognito-idp/user_pools/${POOL_ID}`]: unsupportedResponse() })
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }))
    expect(await screen.findByText('Try a different endpoint.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Tag value 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeDisabled()
  })

  it('opens a group modal with its members', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByText('Groups'))
    fireEvent.click(await screen.findByText('admins'))

    const dialog = await screen.findByRole('dialog', { name: 'admins' })
    expect(await within(dialog).findByText('bob')).toBeInTheDocument()
    expect(within(dialog).getByText('alice')).toBeInTheDocument()
    expect(within(dialog).getByText('alice@example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('UNCONFIRMED')).toBeInTheDocument()
    expect(within(dialog).getByText('Administrators')).toBeInTheDocument()
    expect(requested.some((u) => u.includes(`/api/cognito/user-pools/${POOL_ID}/groups/admins`))).toBe(true)
  })

  it('shows an empty state for a group without members and URL-encodes its name', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)
    fireEvent.click(await screen.findByText('Groups'))
    fireEvent.click(await screen.findByText('night shift/ops'))

    const dialog = await screen.findByRole('dialog', { name: 'night shift/ops' })
    expect(await within(dialog).findByText('No users in this group')).toBeInTheDocument()
    expect(requested.some((u) => u.includes(`/groups/night%20shift%2Fops`))).toBe(true)
  })
})

describe('CloudscapeCognitoIdentityPoolsBrowser (via registry dispatch)', () => {
  it('lists identity pools and opens the detail modal', async () => {
    renderAt('/resources/cognito-identity')
    expect(await screen.findByText('Identity pools')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('ids-pool'))

    const dialog = await screen.findByRole('dialog', { name: 'ids-pool' })
    expect(await within(dialog).findByText('accounts.google.com')).toBeInTheDocument()
    expect(within(dialog).getByText('google-app-id')).toBeInTheDocument()
    expect(within(dialog).getByText('cognito-idp.us-east-1.amazonaws.com/us-east-1_abc')).toBeInTheDocument()
    expect(within(dialog).getByText('Yes')).toBeInTheDocument()
    expect(requested.some((u) => u.includes(`/api/cognito/identity-pools/${encodeURIComponent(IDENTITY_POOL_ID)}`))).toBe(
      true,
    )
  })

  it('closes the identity pool after one browser Back press', async () => {
    renderAt('/resources/cognito-identity')
    fireEvent.click(await screen.findByText('ids-pool'))
    expect(await screen.findByRole('dialog', { name: 'ids-pool' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ids-pool' })).not.toBeInTheDocument())
    expect(screen.getByText('ids-pool')).toBeInTheDocument()
  })

  it('shows identity pool roles and role mappings', async () => {
    renderAt(`/resources/cognito-identity?pool=${encodeURIComponent(IDENTITY_POOL_ID)}`)
    const dialog = await screen.findByRole('dialog', { name: 'ids-pool' })
    expect(await within(dialog).findByText('Roles')).toBeInTheDocument()
    expect(within(dialog).getByText('arn:aws:iam::000000000000:role/Cognito_Auth')).toBeInTheDocument()
    const unauthLabel = within(dialog).getByText('Unauthenticated role')
    expect(within(unauthLabel.parentElement as HTMLElement).getByText('-')).toBeInTheDocument()
    expect(within(dialog).getByText('Role mappings')).toBeInTheDocument()
    const mappingRow = within(dialog)
      .getByText('cognito-idp.us-east-1.amazonaws.com/us-east-1_abc:client-1')
      .closest('tr') as HTMLElement
    expect(within(mappingRow).getByText('Rules')).toBeInTheDocument()
    expect(within(mappingRow).getByText('AuthenticatedRole')).toBeInTheDocument()
    expect(
      within(mappingRow).getByText('cognito:groups Contains admins -> arn:aws:iam::000000000000:role/Admin'),
    ).toBeInTheDocument()
  })

  it('shows messages when identity pool roles could not be loaded', async () => {
    mockFetchByUrl({
      [`/api/cognito/identity-pools/${encodeURIComponent('us-east-1:bare')}`]: {
        ...bareIdentityPoolDetail,
        roles: null,
        roleMappings: null,
      },
    })
    renderAt(`/resources/cognito-identity?pool=${encodeURIComponent('us-east-1:bare')}`)
    const dialog = await screen.findByRole('dialog', { name: 'bare-pool' })
    expect(await within(dialog).findByText('Could not load roles')).toBeInTheDocument()
    expect(within(dialog).getByText('Could not load role mappings')).toBeInTheDocument()
    expect(within(dialog).queryByText('Authenticated role')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('No role mappings')).not.toBeInTheDocument()
  })

  it('shows an error in the identity pool modal for an unknown pool', async () => {
    mockFetchByUrl({ '/api/cognito/identity-pools/bad': null })
    renderAt('/resources/cognito-identity?pool=bad')
    const dialog = await screen.findByRole('dialog', { name: 'bad' })
    expect(await within(dialog).findByText('Could not load identity pool')).toBeInTheDocument()
    expect(within(dialog).getByText('404: Not Found')).toBeInTheDocument()
  })

  it('shows dashes and an empty state when an identity pool has no roles', async () => {
    renderAt(`/resources/cognito-identity?pool=${encodeURIComponent('us-east-1:bare')}`)
    const dialog = await screen.findByRole('dialog', { name: 'bare-pool' })
    expect(await within(dialog).findByText('No role mappings')).toBeInTheDocument()
    const authLabel = within(dialog).getByText('Authenticated role')
    expect(within(authLabel.parentElement as HTMLElement).getByText('-')).toBeInTheDocument()
  })

  it('shows a dash in the rules cell for a mapping without rules', async () => {
    mockFetchByUrl({
      [`/api/cognito/identity-pools/${encodeURIComponent('us-east-1:bare')}`]: {
        ...bareIdentityPoolDetail,
        roleMappings: { 'graph.facebook.com': { Type: 'Token', AmbiguousRoleResolution: 'Deny' } },
      },
    })
    renderAt(`/resources/cognito-identity?pool=${encodeURIComponent('us-east-1:bare')}`)
    const dialog = await screen.findByRole('dialog', { name: 'bare-pool' })
    const row = (await within(dialog).findByText('graph.facebook.com')).closest('tr') as HTMLElement
    expect(within(row).getByText('Token')).toBeInTheDocument()
    expect(within(row).getByText('-')).toBeInTheDocument()
  })
})
