import Box from '@cloudscape-design/components/box'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import type { KeyValuePairsProps } from '@cloudscape-design/components/key-value-pairs'
import LiveRegion from '@cloudscape-design/components/live-region'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import type {
  ClassifiedError,
  ConnectionCheck,
  ConnectionDescription,
  CredentialsSource,
  EmulatorInfo,
  TlsTrustSource,
} from '@/lib/types'
import { isHttpsUrl, lookup } from '@/lib/utils'

const withPath = (label: string, path: string | null) => (path ? `${label} (${path})` : label)

/** ` from <folder>`, say, when the backend named AWS Emulator's folder (it depends on where StackPort runs). */
const folderPhrase = (preposition: 'from' | 'to', folder: string | null) => (folder ? ` ${preposition} ${folder}` : '')

/**
 * Where StackPort's credentials come from, in words. Keyed by every source, so
 * a new one fails typecheck until it has copy here (backend/connection.py); a
 * source from a newer backend shows as it is.
 */
const CREDENTIALS_COPY: Record<CredentialsSource, (connection: ConnectionDescription) => string> = {
  'endpoint-profile': () => "This endpoint's AWS profile",
  'endpoint-keys': () => "This endpoint's access keys",
  'aws-emulator': (c) => `AWS Emulator's keys${folderPhrase('from', c.aws_emulator_dir)}`,
  environment: () => "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from StackPort's environment",
  placeholder: (c) =>
    `Placeholder keys. AWS Emulator runs with authentication off here, so it wrote no keys${folderPhrase('to', c.aws_emulator_dir)}`,
  'default-chain': () => 'The default AWS credential chain (AWS_PROFILE, ~/.aws, or an instance role)',
}

/** Which certificates StackPort trusts, in words. Exhaustive like CREDENTIALS_COPY. */
const TRUST_COPY: Record<TlsTrustSource, (connection: ConnectionDescription) => string> = {
  endpoint: (c) => withPath("This endpoint's CA bundle", c.ca_bundle),
  disabled: () => 'Any certificate: verification is off for this endpoint',
  'aws-emulator': (c) => withPath("AWS Emulator's certificate", c.ca_bundle),
  environment: () => 'The CA bundle in AWS_CA_BUNDLE',
  system: () => "The system's trusted certificates",
}

/** Real AWS (no URL) and https:// endpoints use TLS; plain http:// ones don't. */
function usesTls(url: string | null): boolean {
  return url === null || isHttpsUrl(url)
}

function emulatorLabel(emulator: EmulatorInfo): string {
  return emulator.version ? `${emulator.name} ${emulator.version}` : emulator.name
}

function connectionPairs(check: ConnectionCheck): KeyValuePairsProps.Pair[] {
  const connection = check.connection
  if (!connection) return []
  const credentials = lookup(CREDENTIALS_COPY, connection.credentials_source)
  const pairs: KeyValuePairsProps.Pair[] = [
    { label: 'Credentials', value: credentials ? credentials(connection) : connection.credentials_source },
  ]
  if (usesTls(check.url)) {
    const trust = lookup(TRUST_COPY, connection.tls_trust_source)
    pairs.push({ label: 'Certificates', value: trust ? trust(connection) : connection.tls_trust_source })
  }
  return pairs
}

function errorPairs(detail: ClassifiedError | null): KeyValuePairsProps.Pair[] {
  if (!detail) return []
  const pairs: KeyValuePairsProps.Pair[] = []
  if (detail.code) pairs.push({ label: 'Error code', value: detail.code })
  if (detail.operation) pairs.push({ label: 'Operation', value: detail.operation })
  if (detail.cause) {
    pairs.push({
      label: 'Original error',
      value: (
        <div className="break-words">
          <Box variant="code">{detail.cause}</Box>
        </div>
      ),
    })
  }
  return pairs
}

/**
 * The outcome of testing an endpoint: what StackPort connected to and how, or
 * why it couldn't, with the fix first and the raw error tucked away. The
 * outcome itself is announced to screen readers; the details are left to read.
 */
export function ConnectionCheckSummary({ check }: { check: ConnectionCheck }) {
  if (check.health === 'healthy') {
    const pairs = connectionPairs(check)
    return (
      <SpaceBetween size="s">
        <LiveRegion>
          <StatusIndicator type="success">
            {check.emulator ? `Connected to ${emulatorLabel(check.emulator)}` : 'Connected'}
          </StatusIndicator>
        </LiveRegion>
        {pairs.length > 0 && <KeyValuePairs columns={2} items={pairs} />}
      </SpaceBetween>
    )
  }

  const detail = check.error_detail
  const detailPairs = [
    // Identifying the emulator while the connection fails narrows it down to setup.
    ...(check.emulator ? [{ label: 'Emulator found', value: emulatorLabel(check.emulator) }] : []),
    ...connectionPairs(check),
    ...errorPairs(detail),
  ]
  return (
    <SpaceBetween size="s">
      <LiveRegion>
        <SpaceBetween size="xxs">
          <StatusIndicator type="error">Connection failed</StatusIndicator>
          <Box>{check.error ?? 'StackPort could not connect to the endpoint.'}</Box>
          {detail?.hint && (
            <Box color="text-body-secondary" fontSize="body-s">
              {detail.hint}
            </Box>
          )}
        </SpaceBetween>
      </LiveRegion>
      {detailPairs.length > 0 && (
        <ExpandableSection headerText="Details">
          <KeyValuePairs columns={1} items={detailPairs} />
        </ExpandableSection>
      )}
    </SpaceBetween>
  )
}
