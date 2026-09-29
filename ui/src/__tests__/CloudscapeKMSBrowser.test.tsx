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
  services: { kms: { status: 'available', resources: { keys: 1 } } },
  total_resources: 1,
  uptime_seconds: 60,
}

const DATE = new Date(2024, 1, 1, 0, 0, 0, 0).toLocaleString();

const tags = [{ TagKey: 'key', TagValue: 'value' }]

const key = { keyID: 'KID1', keyArn: 'arn:aws:kms::0:key/KID1', creationDate: DATE, keyUsage: 'ENCRYPT_DECRYPT', keySpec: 'SYMMETRIC_DEFAULT', status: 'Enabled' }
const keyDetail = { status: 'Enabled', origin: 'AWS_KMS', description: null, tags: tags, expiresAt: DATE, rotationStatus: {keyRotationEnabled: false} }
const keyPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Enable IAM User Permissions",
      Effect: "Allow",
      Principal: { "AWS": "arn:aws:iam::000000000000:root" },
      Action: "kms:*",
      Resource: "*"
    }
  ]
}

const keyGrants = { grantID: 'GID1', grantee: 'grantee', operations: ['Encrypt'], creationDate: DATE }
const keyAliases = { aliasName: 'Alias', aliasArn: 'arn:aws:kms::0:alias/Alias', creationDate: DATE }

function mockFetchByUrl() {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = statsPayload
    if (url.includes('/api/kms/keys/KID1/policy')) {
      payload = keyPolicy
    } else if (url.includes('/api/kms/keys/KID1/grants')) {
      payload = [keyGrants]
    } else if (url.includes('/api/kms/keys/KID1/aliases')) {
      payload = [keyAliases]
    } else if (url.match(/\/api\/kms\/keys\/KID1(\?|$)/)) {
      payload = keyDetail
    } else if (url.includes('/api/kms/keys')) {
      payload = { keys: [ key ] }
    } else {
      payload = statsPayload
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  }) as unknown as typeof fetch
}

function renderKMS(path = '/resources/kms') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/resources/:service' element={<CloudscapeResourceBrowser />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetchByUrl()
})

describe('CloudscapeKMSBrowser (via registry dispatch)', () => {
  it('shows the summary of keys in a basic metadata table', async () => {
    renderKMS()
    expect(await screen.findByText('Keys')).toBeInTheDocument()
    expect(await screen.findByText('(1)')).toBeInTheDocument()
  })

  it('lists the correct key metadata in the table', async () => {
    renderKMS()
    expect(await screen.findByText('arn:aws:kms::0:key/KID1')).toBeInTheDocument()
    expect(await screen.findByText('KID1')).toBeInTheDocument()
  })

  it('shows the key detail in a modal', async () => {
    renderKMS('/resources/kms?id=KID1')
    expect((await screen.findAllByText('Enabled')).length).toBeGreaterThan(0)
    expect(await screen.findByText('AWS_KMS')).toBeInTheDocument()
    expect((await screen.findAllByText(DATE)).length).toBeGreaterThan(0)
  })

  it('shows the key policy', async () => {
    renderKMS('/resources/kms?id=KID1')
    fireEvent.click(await screen.findByTestId('policy'))

    const pre = await screen.findByText((_, el) =>
      el?.tagName === 'PRE' && el.textContent?.includes('"Version"') === true
    )
    expect(pre).toHaveTextContent('"Version": "2012-10-17"')
  })

  it('displays the key tags', async () => {
    renderKMS('/resources/kms?id=KID1')
    fireEvent.click(await screen.findByTestId('tags'))
    const panel = await screen.findByRole('tabpanel', { name: /tags/i })
    expect(panel).toHaveTextContent('key')
    expect(panel).toHaveTextContent('value')
  })


  it('displays a table of grants for a key', async () => {
    renderKMS('/resources/kms?id=KID1')
    fireEvent.click(await screen.findByText('Grants'))
    expect(await screen.findByText('GID1')).toBeInTheDocument()
    expect(await screen.findByText('grantee')).toBeInTheDocument()
    expect(await screen.findByText('Encrypt')).toBeInTheDocument()
  })

  it('displays a table of aliases for a key', async () => {
    renderKMS('/resources/kms?id=KID1')
    fireEvent.click(await screen.findByText('Aliases'))
    expect(await screen.findByText('Alias')).toBeInTheDocument()
    expect(await screen.findByText('arn:aws:kms::0:alias/Alias')).toBeInTheDocument()
    expect((await screen.findAllByText(DATE)).length).toBeGreaterThan(0)
  })
})
