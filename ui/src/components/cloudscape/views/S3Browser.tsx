import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '@cloudscape-design/collection-hooks'
import Alert from '@cloudscape-design/components/alert'
import AttributeEditor from '@cloudscape-design/components/attribute-editor'
import Badge from '@cloudscape-design/components/badge'
import Box from '@cloudscape-design/components/box'
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group'
import Button from '@cloudscape-design/components/button'
import ButtonDropdown from '@cloudscape-design/components/button-dropdown'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Form from '@cloudscape-design/components/form'
import FormField from '@cloudscape-design/components/form-field'
import Header from '@cloudscape-design/components/header'
import Icon from '@cloudscape-design/components/icon'
import Input from '@cloudscape-design/components/input'
import Link from '@cloudscape-design/components/link'
import Modal from '@cloudscape-design/components/modal'
import Pagination from '@cloudscape-design/components/pagination'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import SpaceBetween from '@cloudscape-design/components/space-between'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import Tabs from '@cloudscape-design/components/tabs'
import TextFilter from '@cloudscape-design/components/text-filter'
import { toast } from 'sonner'
import {
  createS3Folder,
  deleteS3Object,
  deleteS3ObjectsBatch,
  fetchResourceTags,
  fetchS3Buckets,
  fetchS3Object,
  fetchS3Objects,
  fetchS3UploadConfig,
  getS3DownloadUrl,
  updateResourceTags,
  uploadS3Object,
} from '@/lib/api'
import type { S3Bucket, S3File, S3ObjectDetail, S3ObjectsResponse } from '@/lib/types'
import { useEndpoint } from '@/hooks/useEndpoint'
import { useFetch } from '@/hooks/useFetch'
import { exportData } from '@/lib/export'
import { S3BucketSettingsPanel } from './s3/S3BucketSettingsPanel'

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isFileDrag(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  return Array.from(types as unknown as Iterable<string>).includes('Files')
}

function exportDropdown(resourceType: string, data: Record<string, unknown>[]) {
  if (data.length === 0) return undefined
  return (
    <ButtonDropdown
      items={[
        { id: 'json', text: 'Export as JSON' },
        { id: 'csv', text: 'Export as CSV' },
      ]}
      onItemClick={({ detail }) =>
        exportData({ service: 's3', resourceType, data, format: detail.id as 'json' | 'csv' })
      }
    >
      Export
    </ButtonDropdown>
  )
}

// --- Object detail modal --------------------------------------------------

function keyValueGrid(entries: Array<[string, string]>) {
  return (
    <ColumnLayout columns={2} variant="text-grid">
      {entries.map(([label, value]) => (
        <div key={label}>
          <Box variant="awsui-key-label">{label}</Box>
          <Box fontSize="body-s">{value}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

function ObjectDetailModal({
  detail,
  downloadUrl,
  onClose,
  onDelete,
}: {
  detail: S3ObjectDetail
  downloadUrl: string
  onClose: () => void
  onDelete: () => void
}) {
  const details: Array<[string, string]> = [
    ['Size', formatBytes(detail.size)],
    ['Content-Type', detail.content_type],
    ...(detail.content_encoding ? ([['Encoding', detail.content_encoding]] as Array<[string, string]>) : []),
    ['ETag', detail.etag],
    ['Last modified', formatDate(detail.last_modified)],
    ...(detail.version_id ? ([['Version ID', detail.version_id]] as Array<[string, string]>) : []),
  ]

  return (
    <Modal visible onDismiss={onClose} header={detail.key.split('/').pop()} size="large">
      <SpaceBetween size="m">
        <Box color="text-body-secondary" fontSize="body-s">
          {detail.key}
        </Box>
        <SpaceBetween direction="horizontal" size="xs">
          <Button iconName="download" href={downloadUrl} download>
            Download ({formatBytes(detail.size)})
          </Button>
          <Button iconName="remove" onClick={onDelete} data-testid="detail-delete-object">
            Delete object
          </Button>
        </SpaceBetween>
        <Tabs
          tabs={[
            {
              id: 'details',
              label: 'Details',
              content: (
                <SpaceBetween size="m">
                  {keyValueGrid(details)}
                  {Object.keys(detail.metadata).length > 0 && (
                    <>
                      <Header variant="h3">User metadata</Header>
                      {keyValueGrid(Object.entries(detail.metadata))}
                    </>
                  )}
                  {Object.keys(detail.preserved_headers).length > 0 && (
                    <>
                      <Header variant="h3">HTTP headers</Header>
                      {keyValueGrid(Object.entries(detail.preserved_headers))}
                    </>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: 'tags',
              label: 'Tags',
              content:
                Object.keys(detail.tags).length === 0 ? (
                  <Box color="text-status-inactive">No tags</Box>
                ) : (
                  <SpaceBetween direction="horizontal" size="xs">
                    {Object.entries(detail.tags).map(([key, value]) => (
                      <Badge key={key} color="grey">
                        {key}: {value}
                      </Badge>
                    ))}
                  </SpaceBetween>
                ),
            },
            {
              id: 'raw',
              label: 'Raw',
              content: (
                <Box variant="code">
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                </Box>
              ),
            },
          ]}
        />
      </SpaceBetween>
    </Modal>
  )
}

// --- Bucket tags tab ------------------------------------------------------

function BucketTagsPanel({ bucket }: { bucket: string }) {
  const { activeEndpoint } = useEndpoint()
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchResourceTags('s3', 'buckets', bucket, activeEndpoint)
      .then((res) => {
        if (!cancelled) setTags(Object.entries(res.tags).map(([key, value]) => ({ key, value })))
      })
      .catch(() => {
        if (!cancelled) setTags([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bucket, activeEndpoint])

  const save = async () => {
    setSaving(true)
    try {
      const record = Object.fromEntries(tags.filter((t) => t.key.trim()).map((t) => [t.key.trim(), t.value]))
      await updateResourceTags('s3', 'buckets', bucket, record, activeEndpoint)
      toast.success('Bucket tags updated')
    } catch (error) {
      toast.error(`Failed to update tags: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <StatusIndicator type="loading">Loading tags</StatusIndicator>

  return (
    <SpaceBetween size="m">
      <AttributeEditor
        items={tags}
        onAddButtonClick={() => setTags([...tags, { key: '', value: '' }])}
        onRemoveButtonClick={({ detail }) => setTags(tags.filter((_, i) => i !== detail.itemIndex))}
        addButtonText="Add tag"
        removeButtonText="Remove"
        empty="No tags"
        definition={[
          {
            label: 'Key',
            control: (item, index) => (
              <Input
                value={item.key}
                onChange={({ detail }) => setTags(tags.map((t, i) => (i === index ? { ...t, key: detail.value } : t)))}
              />
            ),
          },
          {
            label: 'Value',
            control: (item, index) => (
              <Input
                value={item.value}
                onChange={({ detail }) => setTags(tags.map((t, i) => (i === index ? { ...t, value: detail.value } : t)))}
              />
            ),
          },
        ]}
      />
      <Button variant="primary" onClick={save} loading={saving} data-testid="save-bucket-tags">
        Save tags
      </Button>
    </SpaceBetween>
  )
}

// --- Object browser -------------------------------------------------------

type ObjectRow =
  | { kind: 'folder'; id: string; name: string; folder: string }
  | { kind: 'file'; id: string; name: string; file: S3File }

type ConfirmDelete =
  | { type: 'delete-file'; key: string }
  | { type: 'delete-bulk'; keys: string[] }
  | { type: 'delete-folder'; folderPrefix: string }

function NewFolderModal({
  prefix,
  onClose,
  onCreate,
}: {
  prefix: string
  onClose: () => void
  onCreate: (folderPrefix: string, segment: string) => Promise<void>
}) {
  const [segment, setSegment] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const cleaned = segment.trim().replace(/^\/+|\/+$/g, '')
    if (!cleaned || cleaned.includes('..') || cleaned.includes('/')) {
      toast.error('Enter a single folder name (no slashes)')
      return
    }
    setSaving(true)
    try {
      await onCreate(`${prefix}${cleaned}/`, cleaned)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible onDismiss={onClose} header="New folder" size="small">
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} data-testid="create-folder-submit">
              Create
            </Button>
          </SpaceBetween>
        }
      >
        <FormField
          label="Folder name"
          description="Folder name under the current path (no slashes). A placeholder object will be created."
        >
          <Input
            value={segment}
            onChange={({ detail }) => setSegment(detail.value)}
            placeholder="my-folder"
            autoFocus
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') void submit()
            }}
          />
        </FormField>
      </Form>
    </Modal>
  )
}

function ObjectBrowser({ bucket, prefix }: { bucket: string; prefix: string }) {
  const { activeEndpoint } = useEndpoint()
  const [, setSearchParams] = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<(() => void) | null>(null)

  const objectsFetcher = useCallback(
    () => fetchS3Objects(bucket, prefix, '/', activeEndpoint),
    [bucket, prefix, activeEndpoint],
  )
  const { data: objectsData, loading, error, refresh } = useFetch<S3ObjectsResponse>(objectsFetcher)

  const [selectedRows, setSelectedRows] = useState<ObjectRow[]>([])
  const [objectDetail, setObjectDetail] = useState<S3ObjectDetail | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchS3UploadConfig()
      .then((c) => {
        if (!cancelled) setMaxUploadBytes(c.max_upload_bytes)
      })
      .catch(() => {
        if (!cancelled) setMaxUploadBytes(DEFAULT_MAX_UPLOAD_BYTES)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelectedRows([])
  }, [bucket, prefix])

  const navigateTo = useCallback(
    (newPrefix: string) => {
      const params: Record<string, string> = { bucket }
      if (newPrefix) params.prefix = newPrefix
      setSearchParams(params)
    },
    [bucket, setSearchParams],
  )

  const navigateUp = useCallback(() => {
    const parts = prefix.replace(/\/$/, '').split('/')
    parts.pop()
    navigateTo(parts.length > 0 ? parts.join('/') + '/' : '')
  }, [prefix, navigateTo])

  // Keyboard parity with the legacy view: Backspace goes up, "/" focuses the filter.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'Backspace' && prefix) {
        e.preventDefault()
        navigateUp()
      } else if (e.key === '/') {
        e.preventDefault()
        containerRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [prefix, navigateUp])

  const rows: ObjectRow[] = useMemo(() => {
    if (!objectsData) return []
    const folderRows: ObjectRow[] = objectsData.folders.map((folder) => ({
      kind: 'folder',
      id: folder,
      name: folder.slice(prefix.length).replace(/\/$/, ''),
      folder,
    }))
    const fileRows: ObjectRow[] = objectsData.files.map((file) => ({
      kind: 'file',
      id: file.key,
      name: file.name,
      file,
    }))
    return [...folderRows, ...fileRows]
  }, [objectsData, prefix])

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(rows, {
    filtering: {
      filteringFunction: (row, text) => row.name.toLowerCase().includes(text.toLowerCase()),
    },
    pagination: { pageSize: 25 },
  })

  const folderCount = objectsData?.folders.length ?? 0
  const fileCount = objectsData?.files.length ?? 0
  const selectedFiles = selectedRows.filter((r): r is Extract<ObjectRow, { kind: 'file' }> => r.kind === 'file')

  const openObject = async (key: string) => {
    try {
      const data = await fetchS3Object(bucket, key, activeEndpoint)
      setObjectDetail(data)
    } catch (err) {
      toast.error(`Failed to load object: ${err}`)
    }
  }

  const effectiveMaxUploadBytes = maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES

  const startUpload = (file: File) => {
    if (file.size > effectiveMaxUploadBytes) {
      toast.error(`File exceeds maximum size (${formatBytes(effectiveMaxUploadBytes)})`)
      return
    }
    const showBar = file.size > 1024 * 1024
    if (showBar) setUploadProgress({ name: file.name, percent: 0 })
    let lastPercent = 0
    void uploadS3Object(bucket, file, prefix, {
      onProgress: showBar
        ? (loaded, total) => {
            const p = total > 0 ? Math.round((100 * loaded) / total) : 0
            if (p !== lastPercent) {
              lastPercent = p
              setUploadProgress({ name: file.name, percent: p })
            }
          }
        : undefined,
      onRegisterAbort: (abort) => {
        uploadAbortRef.current = abort
      },
      endpoint: activeEndpoint,
    })
      .then(() => {
        toast.success(`Uploaded ${file.name}`)
        refresh()
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') {
          toast.message('Upload cancelled')
        } else {
          toast.error(e instanceof Error ? e.message : 'Upload failed')
        }
      })
      .finally(() => {
        setUploadProgress(null)
        uploadAbortRef.current = null
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFileDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) startUpload(f)
  }

  const runDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      if (confirmDelete.type === 'delete-file') {
        await deleteS3Object(bucket, confirmDelete.key, activeEndpoint)
        toast.success('Object deleted')
        if (objectDetail?.key === confirmDelete.key) setObjectDetail(null)
      } else if (confirmDelete.type === 'delete-bulk') {
        await deleteS3ObjectsBatch(bucket, { keys: confirmDelete.keys }, activeEndpoint)
        toast.success(`Deleted ${confirmDelete.keys.length} object(s)`)
        setSelectedRows([])
        setObjectDetail(null)
      } else {
        await deleteS3ObjectsBatch(bucket, { prefix: confirmDelete.folderPrefix }, activeEndpoint)
        toast.success('Folder deleted')
      }
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  const createFolder = async (folderPrefix: string, segment: string) => {
    try {
      await createS3Folder(bucket, folderPrefix, activeEndpoint)
      toast.success(`Created folder ${segment}`)
      setFolderModalOpen(false)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create folder')
    }
  }

  const breadcrumbItems = useMemo(() => {
    const crumbs = [{ text: bucket, href: `?bucket=${encodeURIComponent(bucket)}` }]
    if (prefix) {
      const folders = prefix.replace(/\/$/, '').split('/')
      folders.forEach((folder, idx) => {
        const folderPrefix = folders.slice(0, idx + 1).join('/') + '/'
        crumbs.push({
          text: folder,
          href: `?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(folderPrefix)}`,
        })
      })
    }
    return crumbs
  }, [bucket, prefix])

  return (
    <SpaceBetween size="m">
      <SpaceBetween direction="horizontal" size="xs">
        <Button iconName="arrow-left" onClick={() => setSearchParams({})} ariaLabel="Back to buckets">
          Buckets
        </Button>
        <BreadcrumbGroup
          items={breadcrumbItems}
          ariaLabel="Bucket path"
          onFollow={(event) => {
            event.preventDefault()
            const url = new URL(event.detail.href, window.location.origin)
            navigateTo(url.searchParams.get('prefix') ?? '')
          }}
        />
      </SpaceBetween>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        aria-hidden
        data-testid="s3-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) startUpload(f)
        }}
      />

      {!loading && error && (
        <Alert type="error" header="Could not load objects" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Tabs
        tabs={[
          {
            id: 'objects',
            label: 'Objects',
            content: (
              <div
                ref={containerRef}
                data-testid="s3-object-drop-zone"
                className="relative"
                aria-label="Object list — drop a file here to upload"
                onDragEnter={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (isFileDrag(e)) setFileDragActive(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const next = e.relatedTarget as Node | null
                  if (next && e.currentTarget.contains(next)) return
                  setFileDragActive(false)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={onDrop}
              >
                {fileDragActive && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed text-sm font-medium">
                    Drop file to upload
                  </div>
                )}
                <Table
                  {...collectionProps}
                  items={items}
                  trackBy="id"
                  loading={loading && !objectsData}
                  loadingText="Loading objects"
                  variant="borderless"
                  stickyHeader
                  selectionType="multi"
                  selectedItems={selectedRows}
                  onSelectionChange={({ detail }) => setSelectedRows(detail.selectedItems as ObjectRow[])}
                  isItemDisabled={(row) => row.kind === 'folder'}
                  ariaLabels={{
                    selectionGroupLabel: 'Object selection',
                    itemSelectionLabel: (_data, row) => `Select ${(row as ObjectRow).name}`,
                  }}
                  header={
                    <Header
                      variant="h2"
                      counter={objectsData ? `(${folderCount} folders, ${fileCount} files)` : undefined}
                      actions={
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh objects" />
                          {exportDropdown('objects', (objectsData?.files ?? []) as unknown as Record<string, unknown>[])}
                          <Button iconName="upload" onClick={() => fileInputRef.current?.click()}>
                            Upload
                          </Button>
                          <Button iconName="folder" onClick={() => setFolderModalOpen(true)}>
                            New folder
                          </Button>
                          <Button
                            disabled={selectedFiles.length === 0}
                            onClick={() =>
                              setConfirmDelete({ type: 'delete-bulk', keys: selectedFiles.map((r) => r.file.key) })
                            }
                          >
                            Delete selected
                          </Button>
                        </SpaceBetween>
                      }
                    >
                      {prefix || 'Root'}
                    </Header>
                  }
                  filter={
                    <TextFilter
                      {...filterProps}
                      filteringPlaceholder="Find objects"
                      countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
                    />
                  }
                  pagination={<Pagination {...paginationProps} />}
                  empty={
                    <Box textAlign="center" padding="l">
                      <SpaceBetween size="s">
                        <Box>{prefix ? 'Empty folder' : 'Empty bucket'}</Box>
                        <Box color="text-body-secondary">Upload a file or create a folder.</Box>
                      </SpaceBetween>
                    </Box>
                  }
                  columnDefinitions={[
                    {
                      id: 'name',
                      header: 'Name',
                      cell: (row) =>
                        row.kind === 'folder' ? (
                          <SpaceBetween direction="horizontal" size="xs">
                            <Icon name="folder" />
                            <Link
                              href={`?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(row.folder)}`}
                              onFollow={(event) => {
                                event.preventDefault()
                                navigateTo(row.folder)
                              }}
                            >
                              {row.name}/
                            </Link>
                          </SpaceBetween>
                        ) : (
                          <SpaceBetween direction="horizontal" size="xs">
                            <Icon name="file" />
                            <Link
                              href={`?bucket=${encodeURIComponent(bucket)}`}
                              onFollow={(event) => {
                                event.preventDefault()
                                void openObject(row.file.key)
                              }}
                            >
                              {row.name}
                            </Link>
                          </SpaceBetween>
                        ),
                    },
                    {
                      id: 'type',
                      header: 'Type',
                      cell: (row) => (row.kind === 'folder' ? 'Folder' : row.file.content_type),
                    },
                    {
                      id: 'size',
                      header: 'Size',
                      cell: (row) => (row.kind === 'folder' ? '—' : formatBytes(row.file.size)),
                    },
                    {
                      id: 'modified',
                      header: 'Last modified',
                      cell: (row) => (row.kind === 'folder' ? '—' : formatDate(row.file.last_modified)),
                    },
                    {
                      id: 'actions',
                      header: '',
                      cell: (row) =>
                        row.kind === 'folder' ? (
                          <Button
                            variant="icon"
                            iconName="remove"
                            ariaLabel={`Delete folder ${row.name}`}
                            onClick={() => setConfirmDelete({ type: 'delete-folder', folderPrefix: row.folder })}
                          />
                        ) : (
                          <SpaceBetween direction="horizontal" size="xxs">
                            <Button
                              variant="icon"
                              iconName="download"
                              href={getS3DownloadUrl(bucket, row.file.key, activeEndpoint)}
                              download
                              ariaLabel={`Download ${row.name}`}
                            />
                            <Button
                              variant="icon"
                              iconName="remove"
                              ariaLabel={`Delete ${row.name}`}
                              onClick={() => setConfirmDelete({ type: 'delete-file', key: row.file.key })}
                            />
                          </SpaceBetween>
                        ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            id: 'tags',
            label: 'Tags',
            content: <BucketTagsPanel bucket={bucket} />,
          },
          {
            id: 'settings',
            label: 'Settings',
            content: <S3BucketSettingsPanel bucket={bucket} />,
          },
        ]}
      />

      {uploadProgress && (
        <Modal
          visible
          onDismiss={() => {
            uploadAbortRef.current?.()
            setUploadProgress(null)
          }}
          header="Uploading"
          size="small"
          footer={
            <Box float="right">
              <Button
                onClick={() => {
                  uploadAbortRef.current?.()
                  setUploadProgress(null)
                }}
              >
                Cancel
              </Button>
            </Box>
          }
        >
          <ProgressBar value={uploadProgress.percent} label={uploadProgress.name} />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          visible
          onDismiss={() => setConfirmDelete(null)}
          header="Confirm delete"
          size="small"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void runDelete()} loading={deleting} data-testid="confirm-delete">
                  Delete
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          {confirmDelete.type === 'delete-file' && (
            <Box>
              Delete <Box variant="code">{confirmDelete.key}</Box>?
            </Box>
          )}
          {confirmDelete.type === 'delete-bulk' && <Box>Delete {confirmDelete.keys.length} object(s)? This cannot be undone.</Box>}
          {confirmDelete.type === 'delete-folder' && (
            <Box>
              Delete folder and all objects under <Box variant="code">{confirmDelete.folderPrefix}</Box>?
            </Box>
          )}
        </Modal>
      )}

      {folderModalOpen && <NewFolderModal prefix={prefix} onClose={() => setFolderModalOpen(false)} onCreate={createFolder} />}

      {objectDetail && (
        <ObjectDetailModal
          detail={objectDetail}
          downloadUrl={getS3DownloadUrl(bucket, objectDetail.key, activeEndpoint)}
          onClose={() => setObjectDetail(null)}
          onDelete={() => setConfirmDelete({ type: 'delete-file', key: objectDetail.key })}
        />
      )}
    </SpaceBetween>
  )
}

// --- Bucket list ----------------------------------------------------------

function BucketList({ onOpen }: { onOpen: (bucket: string) => void }) {
  const { activeEndpoint } = useEndpoint()
  const bucketsFetcher = useCallback(() => fetchS3Buckets(activeEndpoint), [activeEndpoint])
  const { data, loading, error, refresh } = useFetch<{ buckets: S3Bucket[] }>(bucketsFetcher, 10000)

  const buckets = data?.buckets ?? []
  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(buckets, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <SpaceBetween size="l">
      {!loading && error && (
        <Alert type="error" header="Could not load buckets" action={<Button onClick={() => refresh()}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Table
        {...collectionProps}
        items={items}
        trackBy="name"
        loading={loading && !data}
        loadingText="Loading buckets"
        variant="borderless"
        stickyHeader
        header={
          <Header
            variant="h2"
            counter={data ? `(${buckets.length})` : undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => refresh()} loading={loading} ariaLabel="Refresh buckets" />
                {exportDropdown('buckets', buckets as unknown as Record<string, unknown>[])}
              </SpaceBetween>
            }
          >
            Buckets
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Find a bucket"
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" padding="l">
            <SpaceBetween size="s">
              <Box>No S3 buckets</Box>
              <Box color="text-body-secondary">Create a bucket to see it here.</Box>
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            sortingField: 'name',
            cell: (b) => (
              <Link
                href={`?bucket=${encodeURIComponent(b.name)}`}
                onFollow={(event) => {
                  event.preventDefault()
                  onOpen(b.name)
                }}
              >
                {b.name}
              </Link>
            ),
          },
          { id: 'region', header: 'Region', sortingField: 'region', cell: (b) => b.region },
          { id: 'created', header: 'Created', sortingField: 'created', cell: (b) => formatDate(b.created) },
          { id: 'objects', header: 'Objects', sortingField: 'object_count', cell: (b) => b.object_count },
          { id: 'size', header: 'Total size', sortingField: 'total_size', cell: (b) => formatBytes(b.total_size) },
          {
            id: 'features',
            header: 'Features',
            cell: (b) => (
              <SpaceBetween direction="horizontal" size="xs">
                {b.versioning === 'Enabled' && <Badge color="green">Versioning</Badge>}
                {b.encryption === 'Enabled' && <Badge color="blue">Encrypted</Badge>}
                {Object.keys(b.tags).length > 0 && <Badge color="grey">{Object.keys(b.tags).length} tags</Badge>}
              </SpaceBetween>
            ),
          },
        ]}
      />
    </SpaceBetween>
  )
}

export function CloudscapeS3Browser() {
  const [searchParams, setSearchParams] = useSearchParams()
  const bucket = searchParams.get('bucket')
  const prefix = searchParams.get('prefix') || ''

  if (bucket) {
    return <ObjectBrowser bucket={bucket} prefix={prefix} />
  }

  return <BucketList onOpen={(name) => setSearchParams({ bucket: name })} />
}
