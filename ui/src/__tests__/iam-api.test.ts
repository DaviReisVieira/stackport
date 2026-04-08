import { describe, expect, it, vi, beforeEach } from 'vitest'
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

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

function mockError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
  })
}

describe('fetchIAMUsers', () => {
  it('calls the correct URL', async () => {
    mockOk({ users: [] })
    const result = await fetchIAMUsers()
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/users')
    expect(result.users).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchIAMUsers()).rejects.toThrow('500')
  })
})

describe('fetchIAMUserDetail', () => {
  it('calls correct URL with encoded name', async () => {
    mockOk({ user: { UserName: 'alice' } })
    await fetchIAMUserDetail('alice')
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/users/alice')
  })

  it('encodes special characters', async () => {
    mockOk({ user: {} })
    await fetchIAMUserDetail('user name')
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/users/user%20name')
  })
})

describe('fetchIAMRoles', () => {
  it('calls the correct URL', async () => {
    mockOk({ roles: [] })
    const result = await fetchIAMRoles()
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/roles')
    expect(result.roles).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchIAMRoles()).rejects.toThrow('500')
  })
})

describe('fetchIAMRoleDetail', () => {
  it('calls correct URL', async () => {
    mockOk({ role: { RoleName: 'my-role' } })
    await fetchIAMRoleDetail('my-role')
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/roles/my-role')
  })
})

describe('fetchIAMGroups', () => {
  it('calls the correct URL', async () => {
    mockOk({ groups: [] })
    const result = await fetchIAMGroups()
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/groups')
    expect(result.groups).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchIAMGroups()).rejects.toThrow('500')
  })
})

describe('fetchIAMGroupDetail', () => {
  it('calls correct URL', async () => {
    mockOk({ group: { GroupName: 'admins' } })
    await fetchIAMGroupDetail('admins')
    expect(mockFetch).toHaveBeenCalledWith('/api/iam/groups/admins')
  })
})

describe('fetchIAMPolicies', () => {
  it('calls correct URL with default scope', async () => {
    mockOk({ policies: [] })
    await fetchIAMPolicies()
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/iam/policies')
    expect(url).toContain('scope=Local')
  })

  it('passes custom scope', async () => {
    mockOk({ policies: [] })
    await fetchIAMPolicies('AWS')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('scope=AWS')
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchIAMPolicies()).rejects.toThrow('500')
  })
})

describe('fetchIAMPolicyDetail', () => {
  it('calls correct URL with encoded ARN', async () => {
    const arn = 'arn:aws:iam::000:policy/MyPolicy'
    mockOk({ policy: { Arn: arn } })
    await fetchIAMPolicyDetail(arn)
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/iam/policies/${encodeURIComponent(arn)}`
    )
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(
      fetchIAMPolicyDetail('arn:aws:iam::000:policy/missing')
    ).rejects.toThrow('404')
  })
})
