import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import createWrapper from '@cloudscape-design/components/test-utils/dom'
import type { ConnectionDescription, EmulatorInfo, Endpoint, HealthResponse } from '@/lib/types'

const endpoints: Endpoint[] = [
  {
    name: 'local',
    url: 'https://127.0.0.1:9297',
    health: 'healthy',
    active: true,
    connection_type: 'local',
    region: 'us-east-1',
    source: 'env',
    auth_type: 'default',
    tls_verify: true,
    ca_bundle: null,
  },
  {
    name: 'staging',
    url: 'http://localhost:5001',
    health: 'unknown',
    active: false,
    connection_type: 'local',
    region: 'eu-west-1',
    source: 'user',
    auth_type: 'default',
    tls_verify: true,
    ca_bundle: null,
  },
]

vi.mock('@/hooks/useEndpoint', () => ({
  useEndpoint: () => ({
    activeEndpoint: 'local',
    endpoints,
    loading: false,
    setActiveEndpoint: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import CloudscapeAbout from '@/pages/CloudscapeAbout'
import CloudscapeSettings from '@/pages/CloudscapeSettings'

const SYSTEM_TRUST: ConnectionDescription = {
  credentials_source: 'environment',
  tls_trust_source: 'system',
  ca_bundle: null,
  aws_emulator_dir: null,
}

function healthPayload(
  emulator: EmulatorInfo | null,
  connection: ConnectionDescription | null = SYSTEM_TRUST,
): HealthResponse {
  return {
    status: 'ok',
    version: 'test',
    uptime_seconds: 1,
    endpoint_url: 'https://127.0.0.1:9297',
    region: 'us-east-1',
    services_count: 35,
    connection_type: 'local',
    writes_enabled: true,
    connection,
    emulator,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

/** Answers /api/health with `health` and everything else the shell and pages ask for with empty data. */
function mockFetch(health: HealthResponse) {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    let payload: unknown = { services: {}, total_resources: 0, uptime_seconds: 1 }
    if (url.includes('/api/health')) payload = health
    else if (url.includes('/api/profiles')) payload = { profiles: [] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/about" element={<CloudscapeAbout />} />
        <Route path="/settings" element={<CloudscapeSettings />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Open the top-nav endpoint menu and return it. */
function openEndpointMenu() {
  const menu = createWrapper()
    .findTopNavigation()!
    .findUtilities()
    .map((utility) => utility.findMenuDropdownType())
    .find((dropdown) => dropdown?.findNativeButton().getElement().textContent === 'local')
  if (!menu) throw new Error('no endpoint menu')
  menu.openDropdown()
  return menu
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('CloudscapeShell endpoint menu', () => {
  it.each(['MiniStack', 'Floci', 'LocalStack', 'Moto', 'AWS Emulator'])(
    'names %s as the emulator behind the active endpoint',
    async (name) => {
      mockFetch(healthPayload({ id: name.toLowerCase().replace(' ', '-'), name }))
      renderAt('/settings')

      const menu = openEndpointMenu()
      await waitFor(() => expect(menu.findDescription()?.getElement().textContent).toBe(`${name} · local · us-east-1`))
      expect(fetchMock).toHaveBeenCalledWith('/api/health?endpoint=local')
      expect(menu.findItemById('local')!.getElement()).toHaveTextContent(`${name} · local · us-east-1`)
      // Only the active endpoint's health is known, so the others name no emulator
      expect(menu.findItemById('staging')!.getElement()).toHaveTextContent('local · eu-west-1')
      expect(menu.findItemById('staging')!.getElement()).not.toHaveTextContent(name)
    },
  )

  it('shows only the connection type and region when no emulator was recognised', async () => {
    mockFetch({ ...healthPayload(null), writes_enabled: false })
    renderAt('/settings')
    // The read-only marker comes from the same health response, so the shell has it
    await screen.findAllByText('Read-only')

    const menu = openEndpointMenu()
    expect(menu.findDescription()?.getElement().textContent).toBe('local · us-east-1')
    expect(menu.findItemById('local')!.getElement()).toHaveTextContent('local · us-east-1')
  })
})

describe('CloudscapeShell certificate warning', () => {
  const UNTRUSTED = { id: 'aws-emulator', name: 'AWS Emulator', version: '1.0.0', tls_trusted: false }

  /** The certificate warning once health has loaded. */
  async function certificateWarning() {
    return waitFor(() => {
      const item = createWrapper().findFlashbar()?.findItemById('tls-untrusted')
      if (!item) throw new Error('no TLS warning yet')
      return item
    })
  }

  it('suggests adding a CA bundle when the trusted certificates do not cover the emulator, and links to Settings', async () => {
    mockFetch(healthPayload(UNTRUSTED))
    renderAt('/about')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent(
      "StackPort reached AWS Emulator but doesn't trust its TLS certificate, so requests to it fail. Add the certificate's CA bundle to this endpoint in Settings.",
    )

    flash.findAction()!.findButton()!.click()
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it("points at the endpoint's own CA bundle when that is what doesn't match", async () => {
    mockFetch(
      healthPayload(
        { id: 'localstack', name: 'LocalStack', tls_trusted: false },
        { ...SYSTEM_TRUST, tls_trust_source: 'endpoint', ca_bundle: '~/certs/localstack-ca.pem' },
      ),
    )
    renderAt('/about')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent(
      "StackPort reached LocalStack but doesn't trust its TLS certificate, so requests to it fail. Check this endpoint's CA bundle (~/certs/localstack-ca.pem) in Settings: StackPort couldn't read it, or it isn't the CA that signed this certificate.",
    )
    expect(flash.findAction()!.findButton()).not.toBeNull()
  })

  it("says StackPort can't read AWS Emulator's files instead of asking for a CA bundle", async () => {
    // The backend can't describe the connection when those files are unreadable
    mockFetch({ ...healthPayload(UNTRUSTED), connection: null })
    renderAt('/about')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent(
      "StackPort reached AWS Emulator but can't read the files AWS Emulator wrote for this port, so it can't trust the emulator's certificate and requests to it fail. Run StackPort as the user that runs the emulator, or point STACKPORT_AWS_EMULATOR_DIR at a copy StackPort can read.",
    )
    expect(flash.findContent()!.getElement()).not.toHaveTextContent('CA bundle')
    // Nothing in Settings fixes file permissions
    expect(flash.findAction()).toBeNull()
  })

  it.each(['~/.aws/emulator/9297', '/srv/aws-emulator/9297'])(
    "says where StackPort looks for AWS Emulator's files when it can't find them (%s)",
    async (folder) => {
      mockFetch(healthPayload(UNTRUSTED, { ...SYSTEM_TRUST, aws_emulator_dir: null, aws_emulator_lookup_dir: folder }))
      renderAt('/about')

      const flash = await certificateWarning()
      expect(flash.findContent()!.getElement()).toHaveTextContent(
        `StackPort reached AWS Emulator but can't find the certificate and keys it writes for this port. StackPort looks in ${folder} on the machine where it runs: run StackPort where it can see that folder, share it as the Compose example does, or point STACKPORT_AWS_EMULATOR_DIR at it.`,
      )
      expect(flash.findContent()!.getElement()).not.toHaveTextContent('CA bundle')
      // Where StackPort runs isn't a setting
      expect(flash.findAction()).toBeNull()
    },
  )

  it("says the certificate didn't verify against AWS Emulator's own CA instead of asking for another one", async () => {
    mockFetch(
      healthPayload(UNTRUSTED, {
        credentials_source: 'aws-emulator',
        tls_trust_source: 'aws-emulator',
        ca_bundle: '~/.aws/emulator/9297/ca.pem',
        aws_emulator_dir: '~/.aws/emulator/9297',
        aws_emulator_lookup_dir: '~/.aws/emulator/9297',
      }),
    )
    renderAt('/about')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent(
      "StackPort reached AWS Emulator but its TLS certificate didn't verify against the CA AWS Emulator wrote in ~/.aws/emulator/9297, so requests to it fail. Try restarting the emulator, then StackPort.",
    )
    expect(flash.findContent()!.getElement()).not.toHaveTextContent('CA bundle')
    expect(flash.findAction()).toBeNull()
  })

  it.each<[string, EmulatorInfo, string | null]>([
    // An https:// URL that isn't on this machine, or STACKPORT_AWS_EMULATOR_DIR turned off
    ['AWS Emulator, with nowhere to look for its files', UNTRUSTED, null],
    // Only AWS Emulator writes its certificate there, so another emulator's missing folder means nothing
    ['another emulator on this machine', { id: 'localstack', name: 'LocalStack', tls_trusted: false }, '~/.aws/emulator/4566'],
  ])('asks for a CA bundle for %s', async (_case, emulator, lookupDir) => {
    mockFetch(healthPayload(emulator, { ...SYSTEM_TRUST, aws_emulator_dir: null, aws_emulator_lookup_dir: lookupDir }))
    renderAt('/about')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent(
      `StackPort reached ${emulator.name} but doesn't trust its TLS certificate, so requests to it fail. Add the certificate's CA bundle to this endpoint in Settings.`,
    )
    expect(flash.findAction()!.findButton()).not.toBeNull()
  })

  it('leaves out the link to Settings on the Settings page', async () => {
    mockFetch(healthPayload(UNTRUSTED))
    renderAt('/settings')

    const flash = await certificateWarning()
    expect(flash.findContent()!.getElement()).toHaveTextContent('Add the certificate')
    expect(flash.findAction()).toBeNull()
  })

  it('stays quiet when the certificate is trusted', async () => {
    mockFetch(healthPayload({ id: 'aws-emulator', name: 'AWS Emulator', tls_trusted: true }))
    renderAt('/about')
    const menu = openEndpointMenu()
    await waitFor(() => expect(menu.findDescription()?.getElement()).toHaveTextContent('AWS Emulator'))

    expect(screen.queryByText(/TLS certificate/)).not.toBeInTheDocument()
  })

  it('stays quiet when certificate verification is off for the endpoint on purpose', async () => {
    // With verification off, StackPort accepts the certificate, so the emulator is trusted
    mockFetch(
      healthPayload(
        { id: 'localstack', name: 'LocalStack', tls_trusted: true },
        { ...SYSTEM_TRUST, tls_trust_source: 'disabled' },
      ),
    )
    renderAt('/about')
    const menu = openEndpointMenu()
    await waitFor(() => expect(menu.findDescription()?.getElement()).toHaveTextContent('LocalStack'))

    expect(screen.queryByText(/TLS certificate/)).not.toBeInTheDocument()
  })
})
