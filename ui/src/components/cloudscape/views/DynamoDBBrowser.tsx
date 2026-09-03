import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import SegmentedControl from '@cloudscape-design/components/segmented-control'
import Select from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Textarea from '@cloudscape-design/components/textarea'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  batchWriteDynamoDBItems,
  createDynamoDBTable,
  deleteDynamoDBItem,
  fetchDynamoDBItems,
  fetchDynamoDBTable,
  fetchDynamoDBTables,
  fetchResourceTags,
  putDynamoDBItem,
  queryDynamoDBTable,
  updateDynamoDBItem,
} from '@/lib/api'
import type { DynamoDBItem, DynamoDBTable, DynamoDBTableDetail } from '@/lib/types'
import { extractKeyDynamo, plainItemToDynamoMap } from '@/lib/dynamodb-marshal'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'

const SORT_OPERATORS = ['=', '<', '<=', '>', '>=', 'BEGINS_WITH'].map((op) => ({ value: op, label: op }))
const PAGE_SIZES = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} items` }))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatAttribute(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return json.length > 60 ? `${json.slice(0, 57)}...` : json
  }
  return String(value)
}

/** Unmarshal a DynamoDB-typed map back to plain JSON (inverse of plainItemToDynamoMap). */
function dynamoMapToPlain(item: Record<string, unknown>): Record<string, unknown> {
  const decode = (av: unknown): unknown => {
    if (av === null || typeof av !== 'object') return av
    const typed = av as Record<string, unknown>
    if ('S' in typed) return typed.S
    if ('N' in typed) return Number(typed.N)
    if ('BOOL' in typed) return typed.BOOL
    if ('NULL' in typed) return null
    if ('L' in typed) return (typed.L as unknown[]).map(decode)
    if ('M' in typed) return Object.fromEntries(Object.entries(typed.M as Record<string, unknown>).map(([k, v]) => [k, decode(v)]))
    if ('SS' in typed || 'NS' in typed) return typed.SS ?? (typed.NS as string[]).map(Number)
    return typed
  }
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, decode(v)]))
}

function keySkeleton(detail: DynamoDBTableDetail): Record<string, unknown> {
  const skeleton: Record<string, unknown> = {}
  if (detail.partition_key) skeleton[detail.partition_key] = detail.partition_key_type === 'N' ? 0 : ''
  if (detail.sort_key) skeleton[detail.sort_key] = detail.sort_key_type === 'N' ? 0 : ''
  return skeleton
}

function ItemEditorModal({
  table,
  initialItem,
  mode,
  onClose,
  onDone,
}: {
  table: DynamoDBTableDetail
  initialItem: Record<string, unknown>
  mode: 'create' | 'edit'
  onClose: () => void
  onDone: () => void
}) {
  const { activeEndpoint } = useEndpoint()
  const [format, setFormat] = useState<'plain' | 'dynamodb'>('plain')
  const [text, setText] = useState(JSON.stringify(initialItem, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const switchFormat = (next: 'plain' | 'dynamodb') => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (next === 'dynamodb' && format === 'plain') {
        setText(JSON.stringify(plainItemToDynamoMap(parsed), null, 2))
      } else if (next === 'plain' && format === 'dynamodb') {
        setText(JSON.stringify(dynamoMapToPlain(parsed), null, 2))
      }
      setFormat(next)
      setError(null)
    } catch {
      setError('Fix the JSON before switching formats')
    }
  }

  const submit = async () => {
    let parsed: DynamoDBItem
    try {
      parsed = JSON.parse(text)
    } catch {
      setError('Invalid JSON')
      return
    }
    setSaving(true)
    try {
      if (mode === 'create') {
        await putDynamoDBItem(table.name, parsed, format, activeEndpoint)
        toast.success('Item created')
      } else {
        await updateDynamoDBItem(table.name, parsed, format, activeEndpoint)
        toast.success('Item updated')
      }
      onDone()
    } catch (err) {
      toast.error(`Failed to save item: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header={mode === 'create' ? `Create item in ${table.name}` : 'Edit item'} size="large">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving}>
              {mode === 'create' ? 'Create item' : 'Save item'}
            </Button>
          </SpaceBetween>
        }
      >
        <FormField label="Item JSON" errorText={error ?? undefined} stretch>
          <SpaceBetween size="xs">
            <SegmentedControl
              selectedId={format}
              onChange={({ detail }) => switchFormat(detail.selectedId as 'plain' | 'dynamodb')}
              label="Item format"
              options={[
                { id: 'plain', text: 'Plain JSON' },
                { id: 'dynamodb', text: 'DynamoDB JSON' },
              ]}
            />
            <Textarea value={text} onChange={({ detail }) => setText(detail.value)} rows={14} spellcheck={false} />
          </SpaceBetween>
        </FormField>
      </Form>
    </Modal>
  )
}

function ItemsPanel({ detail }: { detail: DynamoDBTableDetail }) {
  const { activeEndpoint } = useEndpoint()
  const [items, setItems] = useState<DynamoDBItem[]>([])
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [mode, setMode] = useState<'scan' | 'query'>('scan')
  const [queryPk, setQueryPk] = useState('')
  const [querySk, setQuerySk] = useState('')
  const [querySkOp, setQuerySkOp] = useState('=')
  const [selected, setSelected] = useState<DynamoDBItem[]>([])
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; item: Record<string, unknown> } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const scan = useCallback(
    async (append = false, token?: string | null) => {
      setLoading(true)
      try {
        const data = await fetchDynamoDBItems(detail.name, pageSize, token ?? undefined, activeEndpoint)
        setItems((prev) => (append ? [...prev, ...data.items] : data.items))
        setNextToken(data.next_token)
        setSelected([])
      } catch (err) {
        toast.error(`Scan failed: ${err}`)
      } finally {
        setLoading(false)
      }
    },
    [detail.name, pageSize, activeEndpoint],
  )

  const runQuery = useCallback(async () => {
    if (!queryPk.trim()) {
      toast.error('Enter a partition key value')
      return
    }
    setLoading(true)
    try {
      const data = await queryDynamoDBTable(
        detail.name,
        {
          partition_key_value: queryPk,
          sort_key_value: querySk || null,
          sort_key_operator: querySkOp,
          limit: pageSize,
        },
        activeEndpoint,
      )
      setItems(data.items)
      setNextToken(null)
      setSelected([])
    } catch (err) {
      toast.error(`Query failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [detail.name, queryPk, querySk, querySkOp, pageSize, activeEndpoint])

  useEffect(() => {
    if (mode === 'scan') scan()
  }, [mode, scan])

  const columns = useMemo(() => {
    const keys = new Set<string>()
    if (detail.partition_key) keys.add(detail.partition_key)
    if (detail.sort_key) keys.add(detail.sort_key)
    for (const item of items) for (const k of Object.keys(item)) keys.add(k)
    return [...keys].slice(0, 8)
  }, [items, detail])

  const deleteSelected = async () => {
    setDeleting(true)
    try {
      const operations = selected.map((item) => ({
        op: 'delete' as const,
        key: extractKeyDynamo(plainItemToDynamoMap(item as Record<string, unknown>), detail.partition_key ?? '', detail.sort_key),
      }))
      await batchWriteDynamoDBItems(detail.name, operations, 'dynamodb', activeEndpoint)
      toast.success(`Deleted ${selected.length} item(s)`)
      setSelected([])
      if (mode === 'scan') scan()
      else runQuery()
    } catch (err) {
      toast.error(`Failed to delete items: ${err}`)
    } finally {
      setDeleting(false)
    }
  }

  const deleteOne = async (item: DynamoDBItem) => {
    try {
      const key = extractKeyDynamo(
        plainItemToDynamoMap(item as Record<string, unknown>),
        detail.partition_key ?? '',
        detail.sort_key,
      )
      await deleteDynamoDBItem(detail.name, key, 'dynamodb', activeEndpoint)
      toast.success('Item deleted')
      if (mode === 'scan') scan()
      else runQuery()
    } catch (err) {
      toast.error(`Failed to delete item: ${err}`)
    }
  }

  return (
    <SpaceBetween size="m">
      <SpaceBetween direction="horizontal" size="s">
        <SegmentedControl
          selectedId={mode}
          onChange={({ detail: d }) => setMode(d.selectedId as 'scan' | 'query')}
          label="Read mode"
          options={[
            { id: 'scan', text: 'Scan' },
            { id: 'query', text: 'Query' },
          ]}
        />
        <Select
          selectedOption={{ value: String(pageSize), label: `${pageSize} items` }}
          onChange={({ detail: d }) => setPageSize(Number(d.selectedOption.value))}
          options={PAGE_SIZES}
          ariaLabel="Page size"
        />
      </SpaceBetween>

      {mode === 'query' && (
        <SpaceBetween direction="horizontal" size="s">
          <FormField label={`Partition key (${detail.partition_key ?? 'pk'})`}>
            <Input value={queryPk} onChange={({ detail: d }) => setQueryPk(d.value)} />
          </FormField>
          {detail.sort_key && (
            <>
              <FormField label="Operator">
                <Select
                  selectedOption={{ value: querySkOp, label: querySkOp }}
                  onChange={({ detail: d }) => setQuerySkOp(d.selectedOption.value ?? '=')}
                  options={SORT_OPERATORS}
                />
              </FormField>
              <FormField label={`Sort key (${detail.sort_key})`}>
                <Input value={querySk} onChange={({ detail: d }) => setQuerySk(d.value)} />
              </FormField>
            </>
          )}
          <FormField label="&nbsp;">
            <Button variant="primary" onClick={runQuery} loading={loading}>
              Run query
            </Button>
          </FormField>
        </SpaceBetween>
      )}

      <Table
        items={items}
        trackBy={(item) => JSON.stringify(item)}
        variant="embedded"
        loading={loading && items.length === 0}
        loadingText="Loading items"
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={({ detail: d }) => setSelected(d.selectedItems as DynamoDBItem[])}
        header={
          <Header
            variant="h3"
            counter={`(${items.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => (mode === 'scan' ? scan() : runQuery())} loading={loading} ariaLabel="Reload items" />
                <Button disabled={selected.length === 0} loading={deleting} onClick={deleteSelected}>
                  Delete selected ({selected.length})
                </Button>
                <Button variant="primary" onClick={() => setEditor({ mode: 'create', item: keySkeleton(detail) })}>
                  Create item
                </Button>
              </SpaceBetween>
            }
          >
            Items
          </Header>
        }
        empty={<Box textAlign="center">No items</Box>}
        columnDefinitions={[
          ...columns.map((key) => ({
            id: key,
            header: key,
            cell: (item: DynamoDBItem) => formatAttribute(item[key]),
          })),
          {
            id: 'actions',
            header: '',
            width: 140,
            cell: (item: DynamoDBItem) => (
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="inline-link" onClick={() => setEditor({ mode: 'edit', item: item as Record<string, unknown> })}>
                  Edit
                </Button>
                <Button variant="inline-link" onClick={() => deleteOne(item)}>
                  Delete
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
        footer={
          mode === 'scan' && nextToken ? (
            <Box textAlign="center">
              <Button onClick={() => scan(true, nextToken)} loading={loading}>
                Load more
              </Button>
            </Box>
          ) : undefined
        }
      />

      {editor && (
        <ItemEditorModal
          table={detail}
          mode={editor.mode}
          initialItem={editor.item}
          onClose={() => setEditor(null)}
          onDone={() => {
            setEditor(null)
            if (mode === 'scan') scan()
            else runQuery()
          }}
        />
      )}
    </SpaceBetween>
  )
}

function TableDetailView({ tableName, onBack }: { tableName: string; onBack: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchDynamoDBTable(tableName, activeEndpoint), [tableName, activeEndpoint])
  const { data: detail, loading, error, refresh } = useFetch<DynamoDBTableDetail>(fetcher)
  const tagsFetcher = useCallback(
    () => fetchResourceTags('dynamodb', 'tables', tableName, activeEndpoint),
    [tableName, activeEndpoint],
  )
  const { data: tagsData } = useFetch<{ tags: Record<string, string> }>(tagsFetcher)

  if (loading && !detail) return <StatusIndicator type="loading">Loading table</StatusIndicator>
  if (error && !detail) {
    return (
      <Alert type="error" header="Could not load table" action={<Button onClick={() => refresh()}>Retry</Button>}>
        {error}
      </Alert>
    )
  }
  if (!detail) return null

  const overview: Array<[string, string]> = [
    ['Status', detail.status],
    ['Partition key', detail.partition_key ? `${detail.partition_key} (${detail.partition_key_type})` : '—'],
    ['Sort key', detail.sort_key ? `${detail.sort_key} (${detail.sort_key_type})` : '—'],
    ['Billing mode', detail.billing_mode],
    ['Item count', String(detail.item_count)],
    ['Size', formatBytes(detail.size_bytes)],
    ['Global secondary indexes', String(detail.global_secondary_indexes.length)],
    ['Local secondary indexes', String(detail.local_secondary_indexes.length)],
    ['Created', detail.created ? new Date(detail.created).toLocaleString() : '—'],
  ]

  const tags = tagsData?.tags ?? {}

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onBack}>Back to tables</Button>
            <Button iconName="refresh" onClick={() => refresh()} ariaLabel="Refresh table" />
          </SpaceBetween>
        }
      >
        <SpaceBetween direction="horizontal" size="xs">
          {detail.name}
          <StatusIndicator type={detail.status === 'ACTIVE' ? 'success' : 'in-progress'}>{detail.status}</StatusIndicator>
        </SpaceBetween>
      </Header>

      <ColumnLayout columns={3} variant="text-grid">
        {overview.map(([label, value]) => (
          <div key={label}>
            <Box variant="awsui-key-label">{label}</Box>
            <Box fontSize="body-s">{value}</Box>
          </div>
        ))}
      </ColumnLayout>

      {Object.keys(tags).length > 0 && (
        <SpaceBetween direction="horizontal" size="xs">
          {Object.entries(tags).map(([key, value]) => (
            <Badge key={key} color="grey">
              {key}: {value}
            </Badge>
          ))}
        </SpaceBetween>
      )}

      <ItemsPanel detail={detail} />
    </SpaceBetween>
  )
}


const KEY_TYPE_OPTIONS = [
  { label: 'String', value: 'S' },
  { label: 'Number', value: 'N' },
  { label: 'Binary', value: 'B' },
]

/**
 * Create table, mirroring the console's two sections: Table details (name and
 * keys) then Table settings, where the default is on-demand capacity.
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/getting-started-step-1.html
 */
function CreateTableModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const { activeEndpoint } = useEndpoint()
  const [name, setName] = useState('')
  const [partitionKey, setPartitionKey] = useState('')
  const [partitionType, setPartitionType] = useState('S')
  const [withSortKey, setWithSortKey] = useState(false)
  const [sortKey, setSortKey] = useState('')
  const [sortType, setSortType] = useState('S')
  const [settings, setSettings] = useState<'default' | 'customize'>('default')
  const [billingMode, setBillingMode] = useState('PAY_PER_REQUEST')
  const [readCapacity, setReadCapacity] = useState('5')
  const [writeCapacity, setWriteCapacity] = useState('5')
  const [saving, setSaving] = useState(false)

  const provisioned = settings === 'customize' && billingMode === 'PROVISIONED'
  const duplicateKey = withSortKey && sortKey.trim() !== '' && sortKey.trim() === partitionKey.trim()

  const submit = async () => {
    setSaving(true)
    try {
      await createDynamoDBTable(
        {
          name: name.trim(),
          partitionKey: { name: partitionKey.trim(), type: partitionType },
          sortKey: withSortKey && sortKey.trim() ? { name: sortKey.trim(), type: sortType } : undefined,
          billingMode: settings === 'customize' ? billingMode : 'PAY_PER_REQUEST',
          readCapacity: provisioned ? Number(readCapacity) : undefined,
          writeCapacity: provisioned ? Number(writeCapacity) : undefined,
        },
        activeEndpoint,
      )
      toast.success(`Table '${name.trim()}' created`)
      onDone(name.trim())
    } catch (error) {
      toast.error(`Failed to create table: ${error instanceof Error ? error.message : error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="Create table" size="medium">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={saving}
              disabled={!name.trim() || !partitionKey.trim() || duplicateKey}
              data-testid="create-table-submit"
            >
              Create table
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          <SpaceBetween size="m">
            <Header variant="h3">Table details</Header>
            <FormField label="Table name" description="3 to 255 characters. Unique per region and account.">
              <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="Music" autoFocus />
            </FormField>
            <FormField
              label="Partition key"
              description="How items are distributed and looked up. You cannot change it after the table is created."
            >
              <ColumnLayout columns={2}>
                <Input
                  value={partitionKey}
                  onChange={({ detail }) => setPartitionKey(detail.value)}
                  placeholder="Artist"
                  ariaLabel="Partition key name"
                />
                <div data-testid="partition-key-type">
                  <Select
                    selectedOption={KEY_TYPE_OPTIONS.find((o) => o.value === partitionType) ?? KEY_TYPE_OPTIONS[0]}
                    onChange={({ detail }) => setPartitionType(detail.selectedOption.value as string)}
                    options={KEY_TYPE_OPTIONS}
                    ariaLabel="Partition key type"
                  />
                </div>
              </ColumnLayout>
            </FormField>
            <Checkbox checked={withSortKey} onChange={({ detail }) => setWithSortKey(detail.checked)}>
              Add a sort key
            </Checkbox>
            {withSortKey && (
              <FormField
                label="Sort key"
                description="Orders items that share a partition key, and lets you query ranges."
                errorText={duplicateKey ? 'The sort key must differ from the partition key' : undefined}
              >
                <ColumnLayout columns={2}>
                  <Input
                    value={sortKey}
                    onChange={({ detail }) => setSortKey(detail.value)}
                    placeholder="SongTitle"
                    ariaLabel="Sort key name"
                  />
                  <div data-testid="sort-key-type">
                    <Select
                      selectedOption={KEY_TYPE_OPTIONS.find((o) => o.value === sortType) ?? KEY_TYPE_OPTIONS[0]}
                      onChange={({ detail }) => setSortType(detail.selectedOption.value as string)}
                      options={KEY_TYPE_OPTIONS}
                      ariaLabel="Sort key type"
                    />
                  </div>
                </ColumnLayout>
              </FormField>
            )}
          </SpaceBetween>

          <SpaceBetween size="m">
            <Header variant="h3">Table settings</Header>
            <SegmentedControl
              selectedId={settings}
              onChange={({ detail }) => setSettings(detail.selectedId as 'default' | 'customize')}
              label="Table settings"
              options={[
                { id: 'default', text: 'Default settings' },
                { id: 'customize', text: 'Customize settings' },
              ]}
            />
            {settings === 'default' ? (
              <Box color="text-body-secondary" fontSize="body-s">
                On-demand capacity. You pay per request and the table scales itself — the right default for
                development and for traffic you cannot predict.
              </Box>
            ) : (
              <SpaceBetween size="m">
                <FormField label="Capacity mode">
                  <div data-testid="capacity-mode">
                  <Select
                    selectedOption={
                      billingMode === 'PROVISIONED'
                        ? { label: 'Provisioned', value: 'PROVISIONED' }
                        : { label: 'On-demand', value: 'PAY_PER_REQUEST' }
                    }
                    onChange={({ detail }) => setBillingMode(detail.selectedOption.value as string)}
                    options={[
                      { label: 'On-demand', value: 'PAY_PER_REQUEST' },
                      { label: 'Provisioned', value: 'PROVISIONED' },
                    ]}
                    ariaLabel="Capacity mode"
                  />
                  </div>
                </FormField>
                {provisioned && (
                  <ColumnLayout columns={2}>
                    <FormField label="Read capacity units">
                      <Input type="number" value={readCapacity} onChange={({ detail }) => setReadCapacity(detail.value)} />
                    </FormField>
                    <FormField label="Write capacity units">
                      <Input type="number" value={writeCapacity} onChange={({ detail }) => setWriteCapacity(detail.value)} />
                    </FormField>
                  </ColumnLayout>
                )}
              </SpaceBetween>
            )}
          </SpaceBetween>
        </SpaceBetween>
      </Form>
    </Modal>
  )
}

export function CloudscapeDynamoDBBrowser() {
  const { activeEndpoint } = useEndpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTable = searchParams.get('table')
  const tablesFetcher = useCallback(() => fetchDynamoDBTables(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ tables: DynamoDBTable[] }>(tablesFetcher, 10000)
  const [creating, setCreating] = useState(false)

  const tables = data?.tables ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(tables, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const openTable = useCallback((name: string) => setSearchParams({ table: name }), [setSearchParams])
  const backToList = useCallback(() => {
    setSearchParams({})
    refresh()
  }, [setSearchParams, refresh])

  if (selectedTable) {
    return <TableDetailView tableName={selectedTable} onBack={backToList} />
  }

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load tables" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        loading={loading && !data}
        loadingText="Loading tables"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${tables.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh tables" />
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create table
                </Button>
              </SpaceBetween>
            }
          >
            Tables
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a table"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No tables found</Box>
              <Button onClick={() => setCreating(true)}>Create table</Button>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (t) => (
              <Link
                href={`?table=${encodeURIComponent(t.name)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  openTable(t.name)
                }}
              >
                {t.name}
              </Link>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            sortingField: 'status',
            cell: (t) => <StatusIndicator type={t.status === 'ACTIVE' ? 'success' : 'in-progress'}>{t.status}</StatusIndicator>,
          },
          {
            id: 'keys',
            header: 'Keys',
            cell: (t) => `${t.partition_key ?? '—'}${t.sort_key ? ` / ${t.sort_key}` : ''}`,
          },
          {
            id: 'items',
            header: 'Items',
            sortingField: 'item_count',
            cell: (t) => t.item_count,
          },
          {
            id: 'size',
            header: 'Size',
            sortingField: 'size_bytes',
            cell: (t) => formatBytes(t.size_bytes),
          },
          {
            id: 'billing',
            header: 'Billing',
            cell: (t) => <Badge color="grey">{t.billing_mode}</Badge>,
          },
        ]}
      />

      {creating && (
        <CreateTableModal
          onClose={() => setCreating(false)}
          onDone={(name) => {
            setCreating(false)
            refresh()
            openTable(name)
          }}
        />
      )}
    </SpaceBetween>
  )
}
