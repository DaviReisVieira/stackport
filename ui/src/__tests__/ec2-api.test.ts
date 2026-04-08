import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchEC2Instances,
  fetchEC2InstanceDetail,
  fetchEC2SecurityGroups,
  fetchEC2VPCs,
  fetchEC2KeyPairs,
  startEC2Instance,
  stopEC2Instance,
  rebootEC2Instance,
  terminateEC2Instance,
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

describe('fetchEC2Instances', () => {
  it('calls the correct URL', async () => {
    mockOk({ instances: [] })
    const result = await fetchEC2Instances()
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/instances')
    expect(result.instances).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockError(500)
    await expect(fetchEC2Instances()).rejects.toThrow('500')
  })
})

describe('fetchEC2InstanceDetail', () => {
  it('calls correct URL with encoded ID', async () => {
    mockOk({ instance: { instanceId: 'i-123' } })
    await fetchEC2InstanceDetail('i-123')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/instances/i-123')
  })

  it('encodes special characters', async () => {
    mockOk({ instance: {} })
    await fetchEC2InstanceDetail('i-123 456')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/instances/i-123%20456')
  })
})

describe('startEC2Instance', () => {
  it('sends POST to start endpoint', async () => {
    mockOk({ success: true })
    await startEC2Instance('i-123')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ec2/instances/i-123/start',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(startEC2Instance('i-123')).rejects.toThrow('404')
  })
})

describe('stopEC2Instance', () => {
  it('sends POST to stop endpoint', async () => {
    mockOk({ success: true })
    await stopEC2Instance('i-123')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ec2/instances/i-123/stop',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('rebootEC2Instance', () => {
  it('sends POST to reboot endpoint', async () => {
    mockOk({ success: true, message: 'reboot initiated' })
    await rebootEC2Instance('i-123')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ec2/instances/i-123/reboot',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('terminateEC2Instance', () => {
  it('sends POST to terminate endpoint', async () => {
    mockOk({ success: true })
    await terminateEC2Instance('i-123')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ec2/instances/i-123/terminate',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('fetchEC2SecurityGroups', () => {
  it('calls the correct URL', async () => {
    mockOk({ securityGroups: [] })
    const result = await fetchEC2SecurityGroups()
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/security-groups')
    expect(result.securityGroups).toEqual([])
  })
})

describe('fetchEC2VPCs', () => {
  it('calls the correct URL', async () => {
    mockOk({ vpcs: [] })
    const result = await fetchEC2VPCs()
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/vpcs')
    expect(result.vpcs).toEqual([])
  })
})

describe('fetchEC2KeyPairs', () => {
  it('calls the correct URL', async () => {
    mockOk({ keyPairs: [] })
    const result = await fetchEC2KeyPairs()
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/key-pairs')
    expect(result.keyPairs).toEqual([])
  })
})
