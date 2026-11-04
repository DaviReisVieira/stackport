import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

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
      writes_enabled: true,
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

const userPool = { id: POOL_ID, name: 'main-pool', status: 'Enabled', creationDate: ISO, lastModifiedDate: ISO }
const userPoolDetail = {
  Id: POOL_ID,
  Name: 'main-pool',
  EstimatedNumberOfUsers: 1,
  MfaConfiguration: 'OFF',
  Policies: { PasswordPolicy: { MinimumLength: 8, RequireUppercase: true } },
  SchemaAttributes: [{ Name: 'email', AttributeDataType: 'String', Required: false, Mutable: true }],
  LambdaConfig: { PreSignUp: 'arn:aws:lambda:us-east-1:000000000000:function:pre-signup' },
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
const appClient = {
  clientId: 'client-1',
  clientName: 'web-app',
  explicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH'],
  allowedOAuthFlows: [],
  callbackURLs: [],
  tokenValidity: { accessToken: 60, idToken: null, refreshToken: 30, units: { AccessToken: 'minutes' } },
}
const identityPool = { id: IDENTITY_POOL_ID, name: 'ids-pool' }
const identityPoolDetail = {
  IdentityPoolId: IDENTITY_POOL_ID,
  IdentityPoolName: 'ids-pool',
  AllowUnauthenticatedIdentities: true,
  CognitoIdentityProviders: [{ ProviderName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_abc', ClientId: 'client-1' }],
  SupportedLoginProviders: { 'accounts.google.com': 'google-app-id' },
}

let requested: string[] = []

function mockFetchByUrl() {
  requested = []
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    let payload: unknown = statsPayload
    if (url.includes(`/api/cognito/user-pools/${POOL_ID}/users/alice`)) payload = userDetail
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/users`)) payload = { users: [user] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/groups`)) payload = { groups: [group] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}/clients`)) payload = { clients: [appClient] }
    else if (url.includes(`/api/cognito/user-pools/${POOL_ID}`)) payload = userPoolDetail
    else if (url.includes('/api/cognito/user-pools')) payload = { userPools: [userPool] }
    else if (url.includes(`/api/cognito/identity-pools/${encodeURIComponent(IDENTITY_POOL_ID)}`)) payload = identityPoolDetail
    else if (url.includes('/api/cognito/identity-pools')) payload = { identityPools: [identityPool] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  }) as unknown as typeof fetch
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeCognitoUserPoolsBrowser (via registry dispatch)', () => {
  it('lists user pools', async () => {
    renderAt('/resources/cognito-idp')
    expect(await screen.findByText('User pools')).toBeInTheDocument()
    expect(await screen.findByText('main-pool')).toBeInTheDocument()
    expect(screen.getByText(POOL_ID)).toBeInTheDocument()
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

  it('shows groups, app clients and configuration tabs', async () => {
    renderAt(`/resources/cognito-idp?pool=${POOL_ID}`)

    fireEvent.click(await screen.findByText('Groups'))
    expect(await screen.findByText('Administrators')).toBeInTheDocument()

    fireEvent.click(screen.getByText('App clients'))
    expect(await screen.findByText('web-app')).toBeInTheDocument()
    expect(screen.getByText('ALLOW_USER_PASSWORD_AUTH')).toBeInTheDocument()
    expect(screen.getByText('Access 60 minutes, Refresh 30 days')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Configuration'))
    expect(await screen.findByText('Password policy')).toBeInTheDocument()
    expect(screen.getByText('PreSignUp')).toBeInTheDocument()
    expect(screen.getByText('OFF')).toBeInTheDocument()
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
})
