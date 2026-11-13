import Box from '@cloudscape-design/components/box'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'

/** A block of shell text with a copy button, so nobody retypes a command. */
export function CopyableCode({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <Box variant="code" padding="n">
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{text}</pre>
      </Box>
      <CopyToClipboard
        copyButtonAriaLabel={`Copy ${copyLabel}`}
        textToCopy={text}
        variant="icon"
        copySuccessText={`${copyLabel[0].toUpperCase()}${copyLabel.slice(1)} copied`}
        copyErrorText={`Could not copy the ${copyLabel}`}
      />
    </div>
  )
}
