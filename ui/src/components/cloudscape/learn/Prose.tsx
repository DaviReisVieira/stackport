import Box from '@cloudscape-design/components/box'

/**
 * Lesson prose: blank lines separate paragraphs, **text** is emphasis, and
 * `text` is code. Deliberately not a markdown renderer, because trail content
 * is authored in this repo and a full parser would be a dependency and an
 * injection surface in exchange for syntax nobody asked for.
 */
export function Prose({ text, small = false }: { text: string; small?: boolean }) {
  const paragraphs = text.split('\n\n').filter(Boolean)
  return (
    <div>
      {paragraphs.map((paragraph, index) => (
        <Box
          key={index}
          variant={small ? 'small' : 'p'}
          color="text-body-secondary"
          padding={{ top: index === 0 ? 'n' : 'xxs', bottom: 'n' }}
        >
          {inline(paragraph)}
        </Box>
      ))}
    </div>
  )
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g

function inline(paragraph: string) {
  return paragraph.split(TOKEN).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <Box key={index} variant="code" display="inline">
          {part.slice(1, -1)}
        </Box>
      )
    }
    return part
  })
}
