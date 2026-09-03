import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  services: { ec2: { status: 'available', resources: { instances: 2 } } },
  total_resources: 2,
  uptime_seconds: 60,
}

const instances = [
  {
    instanceId: 'i-0abc',
    name: 'web-server',
    state: 'running',
    instanceType: 't3.micro',
    imageId: 'ami-123',
    launchTime: '2026-01-01T00:00:00Z',
    publicIpAddress: '54.1.2.3',
    privateIpAddress: '10.0.0.5',
    vpcId: 'vpc-1',
    subnetId: 'subnet-1',
    keyName: 'my-key',
    securityGroups: [{ GroupId: 'sg-1', GroupName: 'web-sg' }],
    tags: [{ Key: 'env', Value: 'dev' }],
  },
  {
    instanceId: 'i-0def',
    name: 'worker',
    state: 'stopped',
    instanceType: 't3.small',
    launchTime: '2026-01-02T00:00:00Z',
    securityGroups: [],
    tags: [],
  },
]

const instanceDetail = {
  instance: {
    ...instances[0],
    stateCode: 16,
    networkInterfaces: [],
    blockDeviceMappings: [],
    userData: '#!/bin/bash\necho hello',
  },
}

const stoppedDetail = {
  instance: {
    ...instances[1],
    stateCode: 80,
    networkInterfaces: [],
    blockDeviceMappings: [],
    userData: null,
  },
}

const securityGroups = [
  {
    groupId: 'sg-1',
    groupName: 'web-sg',
    description: 'Web tier',
    vpcId: 'vpc-1',
    ipPermissions: [{}],
    ipPermissionsEgress: [{}, {}],
    tags: [],
  },
]

const inboundRules = {
  groupId: 'sg-1',
  groupName: 'web-sg',
  inboundRules: [
    {
      ruleId: 'sgr-in-1',
      ipVersion: 'IPv4',
      type: 'Inbound',
      protocol: 'tcp',
      portRange: '443',
      source: '0.0.0.0/0',
      description: 'HTTPS from anywhere',
    },
  ],
}

const outboundRules = {
  groupId: 'sg-1',
  groupName: 'web-sg',
  outboundRules: [
    {
      ruleId: 'sgr-out-1',
      ipVersion: 'IPv4',
      type: 'Outbound',
      protocol: '-1',
      portRange: 'All',
      source: '0.0.0.0/0',
      description: '',
    },
  ],
}

const vpcs = [
  {
    vpcId: 'vpc-1',
    cidrBlock: '10.0.0.0/16',
    state: 'available',
    isDefault: true,
    tags: [],
    subnets: [
      {
        subnetId: 'subnet-1',
        cidrBlock: '10.0.1.0/24',
        availabilityZone: 'us-east-1a',
        availableIpAddressCount: 250,
        state: 'available',
        tags: [],
      },
    ],
  },
]

const asgs = [
  {
    autoScalingGroupARN: 'arn:aws:autoscaling:us-east-1:0:autoScalingGroup:x:autoScalingGroupName/web-asg',
    autoScalingGroupName: 'web-asg',
    createdTime: '2026-01-01T00:00:00Z',
    desiredCapacity: 2,
    maxSize: 4,
    minSize: 1,
    availabilityZones: ['us-east-1a'],
    healthCheckGracePeriod: 300,
    instanceCount: 1,
    instances: [
      { instanceId: 'i-0abc', lifecycleState: 'InService', healthStatus: 'Healthy', availabilityZone: 'us-east-1a' },
    ],
    loadBalancerNames: [],
    tags: [],
  },
]

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchByUrl() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    let payload: unknown = statsPayload
    if (url.includes('/api/ec2/instances/i-0abc/start')) payload = { success: true }
    else if (url.includes('/api/ec2/instances/i-0def/start')) payload = { success: true, state: { previous: 'stopped', current: 'pending' } }
    else if (url.includes('/api/ec2/instances/i-0abc/terminate')) payload = { success: true }
    else if (url.includes('/api/ec2/instances/i-0abc')) payload = instanceDetail
    else if (url.includes('/api/ec2/instances/i-0def')) payload = stoppedDetail
    else if (url.includes('/api/ec2/instances')) payload = { instances }
    else if (url.includes('/api/ec2/security-groups/sg-1/inbound')) payload = inboundRules
    else if (url.includes('/api/ec2/security-groups/sg-1/outbound')) payload = outboundRules
    else if (url.includes('/api/ec2/security-groups')) payload = { securityGroups }
    else if (url.includes('/api/ec2/vpcs')) payload = { vpcs }
    else if (url.includes('/api/ec2/asgs')) payload = { auto_scaling_groups: asgs }
    else if (url.includes('/api/tags/ec2/instances/i-0abc') && method === 'PUT') payload = { success: true }
    else if (url.includes('/api/stats')) payload = statsPayload
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderEC2(path = '/resources/ec2') {
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

describe('CloudscapeEC2Browser (via registry dispatch)', () => {
  it('shows summary counters and lists instances', async () => {
    renderEC2()
    expect(await screen.findByText('Instances (2)')).toBeInTheDocument()
    expect(await screen.findByText('i-0abc')).toBeInTheDocument()
    expect(await screen.findByText('web-server')).toBeInTheDocument()
    expect(await screen.findByText('running')).toBeInTheDocument()
    expect(await screen.findByText('54.1.2.3')).toBeInTheDocument()
    expect(await screen.findByText('Security groups (1)')).toBeInTheDocument()
  })

  it('opens the instance detail with user data, networking and disables Start when running', async () => {
    renderEC2()
    fireEvent.click(await screen.findByRole('link', { name: 'i-0abc' }))
    expect(await screen.findByText(/echo hello/)).toBeInTheDocument()
    expect(screen.getByTestId('instance-start')).toBeDisabled()
    expect(screen.getByTestId('instance-stop')).toBeEnabled()

    fireEvent.click(screen.getByText('Networking'))
    expect(await screen.findByText('10.0.0.5')).toBeInTheDocument()
    expect(await screen.findByText('subnet-1')).toBeInTheDocument()
  })

  it('starts a stopped instance via the start endpoint', async () => {
    renderEC2('/resources/ec2?instance=i-0def')
    const startButton = await screen.findByTestId('instance-start')
    await waitFor(() => expect(startButton).toBeEnabled())
    fireEvent.click(startButton)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/i-0def/start') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
  })

  it('terminates only after the confirmation modal', async () => {
    renderEC2('/resources/ec2?instance=i-0abc')
    fireEvent.click(await screen.findByTestId('instance-terminate'))
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes('/terminate'))).toBeFalsy()

    fireEvent.click(await screen.findByTestId('confirm-terminate'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/i-0abc/terminate') && (init as RequestInit)?.method === 'POST',
      )
      expect(call).toBeTruthy()
    })
  })

  it('saves instance tags from the detail Tags tab', async () => {
    renderEC2('/resources/ec2?instance=i-0abc')
    await screen.findByText(/echo hello/)
    fireEvent.click(screen.getByText('Tags'))

    const valueInput = await screen.findByDisplayValue('dev')
    fireEvent.change(valueInput, { target: { value: 'prod' } })
    fireEvent.click(screen.getByTestId('save-instance-tags'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
      expect(call).toBeTruthy()
    })
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(String(call![0])).toContain('/api/tags/ec2/instances/i-0abc')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ tags: { env: 'prod' } })
  })

  it('opens a security group with inbound and outbound rule tables', async () => {
    renderEC2()
    fireEvent.click(await screen.findByText('Security groups (1)'))
    fireEvent.click(await screen.findByRole('link', { name: 'sg-1' }))

    expect(await screen.findByText('sgr-in-1')).toBeInTheDocument()
    expect(await screen.findByText('HTTPS from anywhere')).toBeInTheDocument()

    fireEvent.click(await screen.findByText(/Outbound rules \(1\)/))
    expect(await screen.findByText('sgr-out-1')).toBeInTheDocument()
  })

  it('shows VPC subnets and ASG instances', async () => {
    renderEC2()
    fireEvent.click(await screen.findByText('VPCs (1)'))
    fireEvent.click(await screen.findByText('vpc-1'))
    expect(await screen.findByText('10.0.1.0/24')).toBeInTheDocument()
    expect(await screen.findByText('250')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Auto Scaling groups (1)'))
    fireEvent.click(await screen.findByText('web-asg'))
    expect(await screen.findByText('InService')).toBeInTheDocument()
    expect(await screen.findByText('Healthy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(await screen.findByText('2 / 1 / 4')).toBeInTheDocument()
    expect(await screen.findByText('300s')).toBeInTheDocument()
  })
})
