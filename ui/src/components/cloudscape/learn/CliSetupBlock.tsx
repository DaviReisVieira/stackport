import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import type { LearnCliSetup } from '@/lib/types'
import { CopyableCode } from './CopyableCode'
import { Prose } from './Prose'

/**
 * What this endpoint's emulator needs from the shell before the commands below
 * will run, which the plain `--endpoint-url` form does not cover. Shown only
 * when the server reports some, so emulators that need nothing look unchanged.
 * Learn shows it next to CLI steps, the API Explorer next to copied commands.
 */
export function CliSetupBlock({ setup }: { setup: LearnCliSetup }) {
  return (
    <Alert type="info" header={`${setup.emulator} needs a little setup first`} data-testid="cli-setup">
      <SpaceBetween size="xs">
        <Box variant="p" padding="n">
          Run this once in the terminal you will use for the commands below. It points the AWS CLI and boto3 at the
          keys and certificate {setup.emulator} created when it started.
        </Box>
        <CopyableCode text={setup.script} copyLabel="setup" />
        {setup.note && <Prose text={setup.note} small />}
      </SpaceBetween>
    </Alert>
  )
}
