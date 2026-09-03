import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
      services_count: 1,
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
  services: { iam: { status: 'available', resources: { users: 1, roles: 1, policies: 1 } } },
  total_resources: 3,
  uptime_seconds: 60,
}

const user = { UserName: 'alice', UserId: 'AID1', Arn: 'arn:aws:iam::0:user/alice', Path: '/', CreateDate: '2026-01-01T00:00:00Z' }
const role = { RoleName: 'admin-role', RoleId: 'RID1', Arn: 'arn:aws:iam::0:role/admin-role', Path: '/', CreateDate: '2026-01-01T00:00:00Z' }
const group = { GroupName: 'devs', GroupId: 'GID1', Arn: 'arn:aws:iam::0:group/devs', Path: '/', CreateDate: '2026-01-01T00:00:00Z' }
const policy = {
  PolicyName: 'app-policy',
  PolicyId: 'PID1',
  Arn: 'arn:aws:iam::0:policy/app-policy',
  Path: '/',
  DefaultVersionId: 'v1',
  AttachmentCount: 2,
  CreateDate: '2026-01-01T00:00:00Z',
  UpdateDate: '2026-01-02T00:00:00Z',
}

const userDetail = {
  user,
  attached_policies: [{ PolicyName: 'app-policy', PolicyArn: policy.Arn }],
  inline_policies: [{ name: 'inline-read', document: { Statement: [{ Action: 's3:GetObject' }] } }],
  groups: [group],
  access_keys: [{ UserName: 'alice', AccessKeyId: 'AKIA123', Status: 'Active', CreateDate: '2026-01-05T00:00:00Z' }],
  tags: { team: 'core' },
}

const roleDetail = {
  role,
  trust_policy: { Statement: [{ Principal: { Service: 'lambda.amazonaws.com' } }] },
  attached_policies: [],
  inline_policies: [],
  tags: {},
}

const policyDetail = {
  policy,
  document: { Statement: [{ Effect: 'Allow', Action: 's3:*' }] },
  attached_to: { users: [{ UserName: 'alice' }], roles: [{ RoleName: 'admin-role' }], groups: [] },
  tags: {},
}

function mockFetchByUrl() {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/api/iam/users/alice')) payload = userDetail
    else if (url.includes('/api/iam/roles/admin-role')) payload = roleDetail
    else if (url.includes('/api/iam/policies/arn')) payload = policyDetail
    else if (url.includes('/api/iam/users')) payload = { users: [user] }
    else if (url.includes('/api/iam/roles')) payload = { roles: [role] }
    else if (url.includes('/api/iam/groups')) payload = { groups: [group] }
    else if (url.includes('/api/iam/policies')) payload = { policies: [policy] }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  }) as unknown as typeof fetch
}

function renderIAM(path = '/resources/iam') {
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

describe('CloudscapeIAMBrowser (via registry dispatch)', () => {
  it('shows the four entity tabs with counts and lists users', async () => {
    renderIAM()
    expect(await screen.findByText('Users (1)')).toBeInTheDocument()
    expect(await screen.findByText('Groups (1)')).toBeInTheDocument()
    expect(await screen.findByText('Roles (1)')).toBeInTheDocument()
    expect(await screen.findByText('Policies (1)')).toBeInTheDocument()
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })

  it('opens the user detail with policies, groups and access keys', async () => {
    renderIAM()
    fireEvent.click(await screen.findByRole('link', { name: 'alice' }))
    expect(await screen.findByText('AID1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Policies'))
    expect(await screen.findByText('app-policy')).toBeInTheDocument()
    expect(await screen.findByText('inline-read')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Access keys \(1\)/))
    expect(await screen.findByText('AKIA123')).toBeInTheDocument()
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('shows the role trust policy JSON', async () => {
    renderIAM()
    fireEvent.click(await screen.findByText('Roles (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'admin-role' }))
    fireEvent.click(await screen.findByText('Trust policy'))
    expect(await screen.findByText(/lambda\.amazonaws\.com/)).toBeInTheDocument()
  })

  it('shows the policy document and attachments', async () => {
    renderIAM()
    fireEvent.click(await screen.findByText('Policies (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'app-policy' }))
    fireEvent.click(await screen.findByText('Document'))
    expect(await screen.findByText(/"s3:\*"/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Attached to'))
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(await screen.findByText('admin-role')).toBeInTheDocument()
  })

  it('deep-links straight into an entity detail', async () => {
    renderIAM('/resources/iam?type=user&name=alice')
    expect(await screen.findByText('AID1')).toBeInTheDocument()
  })
})
