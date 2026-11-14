import { useEffect, useMemo, useRef, useState } from 'react'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Header from '@cloudscape-design/components/header'
import Pagination from '@cloudscape-design/components/pagination'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Table from '@cloudscape-design/components/table'
import TextFilter from '@cloudscape-design/components/text-filter'
import type { ExplorerAccess, ExplorerOperationSummary } from '@/lib/types'

const PAGE_SIZE = 25

function matches(operation: ExplorerOperationSummary, text: string): boolean {
  return operation.name.toLowerCase().includes(text.trim().toLowerCase())
}

type AccessFilter = 'all' | ExplorerAccess

const ACCESS_OPTIONS: { id: AccessFilter; text: string }[] = [
  { id: 'all', text: 'All' },
  { id: 'read', text: 'Read' },
  { id: 'write', text: 'Write' },
]

export function AccessBadge({ access }: { access: ExplorerAccess }) {
  return access === 'read' ? <Badge color="green">Read</Badge> : <Badge color="blue">Write</Badge>
}

/**
 * A service's operations with a name filter and a read/write filter. Key it by
 * service, so filters start over when the service changes.
 */
export function OperationList({
  operations,
  loading,
  selected,
  onSelect,
}: {
  operations: ExplorerOperationSummary[]
  loading: boolean
  selected: string | null
  onSelect: (operation: string) => void
}) {
  const [access, setAccess] = useState<AccessFilter>('all')
  const shown = useMemo(
    () => (access === 'all' ? operations : operations.filter((operation) => operation.access === access)),
    [operations, access],
  )
  const { items, actions, filteredItemsCount, filterProps, collectionProps, paginationProps } = useCollection(shown, {
    filtering: {
      filteringFunction: matches,
      noMatch: <Box textAlign="center" color="inherit">No operation matches the filter</Box>,
      empty: <Box textAlign="center" color="inherit">No operations</Box>,
    },
    pagination: { pageSize: PAGE_SIZE },
  })
  const selectedItem = operations.find((operation) => operation.name === selected)

  // Open the page holding the selected operation when the selection or the list
  // changes (a deep link, the service loading, a request from history), but not
  // when someone pages or filters on their own.
  const position = shown.filter((operation) => matches(operation, filterProps.filteringText)).findIndex((operation) => operation.name === selected)
  const selectedPage = position < 0 ? null : Math.floor(position / PAGE_SIZE) + 1
  const placed = useRef<{ selected: string | null; shown: ExplorerOperationSummary[] } | null>(null)
  useEffect(() => {
    if (placed.current?.selected === selected && placed.current.shown === shown) return
    placed.current = { selected, shown }
    if (selectedPage !== null) actions.setCurrentPage(selectedPage)
  }, [selected, shown, selectedPage, actions])

  return (
    <Table
      {...collectionProps}
      variant="container"
      items={items}
      loading={loading}
      loadingText="Loading operations"
      trackBy="name"
      selectionType="single"
      selectedItems={selectedItem ? [selectedItem] : []}
      onSelectionChange={({ detail }) => {
        const [item] = detail.selectedItems
        if (item) onSelect(item.name)
      }}
      onRowClick={({ detail }) => onSelect(detail.item.name)}
      ariaLabels={{
        selectionGroupLabel: 'Operations',
        itemSelectionLabel: (_, operation) => operation.name,
        allItemsSelectionLabel: () => 'Operations',
      }}
      header={
        <Header counter={filterProps.filteringText || access !== 'all' ? `(${filteredItemsCount}/${operations.length})` : `(${operations.length})`}>
          Operations
        </Header>
      }
      filter={
        <SpaceBetween size="xs">
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find an operation"
            filteringAriaLabel="Filter operations"
            countText={`${filteredItemsCount} matches`}
          />
          <SegmentedControl
            label="Access"
            selectedId={access}
            options={ACCESS_OPTIONS}
            onChange={({ detail }) => setAccess(detail.selectedId as AccessFilter)}
          />
        </SpaceBetween>
      }
      pagination={<Pagination {...paginationProps} />}
      columnDefinitions={[
        {
          id: 'name',
          header: 'Operation',
          cell: (operation) =>
            operation.deprecated ? (
              <Box color="text-body-secondary">
                {operation.name} <i>(deprecated)</i>
              </Box>
            ) : (
              operation.name
            ),
        },
        { id: 'access', header: 'Access', cell: (operation) => <AccessBadge access={operation.access} /> },
      ]}
    />
  )
}
