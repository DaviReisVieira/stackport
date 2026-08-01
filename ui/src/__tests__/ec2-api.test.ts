import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchEC2Instances,
  fetchEC2InstanceDetail,
  fetchEC2SecurityGroups,
  fetchEC2SecurityGroupInboundRules,
  fetchEC2SecurityGroupOutboundRules,
  fetchEC2VPCs,
  fetchEC2KeyPairs,
  startEC2Instance,
  stopEC2Instance,
  rebootEC2Instance,
  terminateEC2Instance,
} from '@/lib/api'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

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

describe('fetchEC2SecurityGroupInboundRules', () => {
  it('calls correct URL with encoded group ID', async () => {
    mockOk({ groupId: 'sg-123', groupName: 'test-sg', inboundRules: [] })
    await fetchEC2SecurityGroupInboundRules('sg-123')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/security-groups/sg-123/inbound')
  })

  it('encodes special characters in group ID', async () => {
    mockOk({ groupId: 'sg-123', groupName: 'test', inboundRules: [] })
    await fetchEC2SecurityGroupInboundRules('sg-123 456')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/security-groups/sg-123%20456/inbound')
  })

  it('returns inbound rules data', async () => {
    const mockData = {
      groupId: 'sg-123456',
      groupName: 'web-sg',
      inboundRules: [
        {
          ruleId: 'inbound-sgrule-0001',
          name: 'HTTP access',
          ipVersion: 'IPv4',
          type: 'Inbound',
          protocol: 'tcp',
          portRange: '80',
          source: '0.0.0.0/0',
          description: 'HTTP access',
        },
      ],
    }
    mockOk(mockData)
    const result = await fetchEC2SecurityGroupInboundRules('sg-123456')
    expect(result.groupId).toBe('sg-123456')
    expect(result.groupName).toBe('web-sg')
    expect(result.inboundRules).toHaveLength(1)
    expect(result.inboundRules[0].ruleId).toBe('inbound-sgrule-0001')
    expect(result.inboundRules[0].protocol).toBe('tcp')
    expect(result.inboundRules[0].portRange).toBe('80')
    expect(result.inboundRules[0].ipVersion).toBe('IPv4')
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(fetchEC2SecurityGroupInboundRules('sg-nonexistent')).rejects.toThrow('404')
  })
})

describe('fetchEC2SecurityGroupOutboundRules', () => {
  it('calls correct URL with encoded group ID', async () => {
    mockOk({ groupId: 'sg-123', groupName: 'test-sg', outboundRules: [] })
    await fetchEC2SecurityGroupOutboundRules('sg-123')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/security-groups/sg-123/outbound')
  })

  it('encodes special characters in group ID', async () => {
    mockOk({ groupId: 'sg-123', groupName: 'test', outboundRules: [] })
    await fetchEC2SecurityGroupOutboundRules('sg-123 456')
    expect(mockFetch).toHaveBeenCalledWith('/api/ec2/security-groups/sg-123%20456/outbound')
  })

  it('returns outbound rules data', async () => {
    const mockData = {
      groupId: 'sg-123456',
      groupName: 'web-sg',
      outboundRules: [
        {
          ruleId: 'outbound-sgrule-0001',
          name: 'HTTPS outbound',
          ipVersion: 'IPv4',
          type: 'Outbound',
          protocol: 'tcp',
          portRange: '443',
          source: '0.0.0.0/0',
          description: 'HTTPS outbound',
        },
      ],
    }
    mockOk(mockData)
    const result = await fetchEC2SecurityGroupOutboundRules('sg-123456')
    expect(result.groupId).toBe('sg-123456')
    expect(result.groupName).toBe('web-sg')
    expect(result.outboundRules).toHaveLength(1)
    expect(result.outboundRules[0].ruleId).toBe('outbound-sgrule-0001')
    expect(result.outboundRules[0].protocol).toBe('tcp')
    expect(result.outboundRules[0].portRange).toBe('443')
    expect(result.outboundRules[0].ipVersion).toBe('IPv4')
  })

  it('throws on non-ok response', async () => {
    mockError(404)
    await expect(fetchEC2SecurityGroupOutboundRules('sg-nonexistent')).rejects.toThrow('404')
  })
})
