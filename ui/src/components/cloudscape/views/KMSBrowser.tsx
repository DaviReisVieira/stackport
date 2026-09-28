import { Badge, Box, Modal, StatusIndicator, type StatusIndicatorProps } from '@cloudscape-design/components';
import { useFetch } from '@/hooks/useFetch';
import SpaceBetween from '@cloudscape-design/components/space-between'
import Header from '@cloudscape-design/components/header'
import Button from '@cloudscape-design/components/button';
import { useEndpoint } from '@/hooks/useEndpoint';
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Tabs from '@cloudscape-design/components/tabs';
import Table from '@cloudscape-design/components/table';
import Pagination from '@cloudscape-design/components/pagination';
import TextFilter from '@cloudscape-design/components/text-filter';
import Link from '@cloudscape-design/components/link';
import type { KMSKey, KMSKeyAlias, KMSKeyDetail, KMSKeyGrant, Tag } from '@/lib/types';
import { useCallback } from 'react';
import { fetchKMSKeyAliases, fetchKMSKeyDetail, fetchKMSKeyGrants, fetchKMSKeyPolicy, fetchKMSKeys } from '@/lib/api';
import { useCollection } from '@cloudscape-design/collection-hooks'
import { useSearchParams } from 'react-router-dom';


function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function keyStateIndicator(state: string) {
  const type: Record<string, StatusIndicatorProps.Type> = {
    creating: 'in-progress',
    enabled: 'success',
    disabled: 'stopped',
    pendingDeletion: 'warning',
    pendingImport: 'in-progress',
    pendingReplicaDeletion: 'warning',
    unavailable: 'error',
    updating: 'in-progress'
  }

  return <StatusIndicator type={type[state]}>{state}</StatusIndicator>
}

function kvGrid(rows: Array<[string, string | undefined| number]>) {
  return (
    <ColumnLayout columns={2} variant='text-grid'>
      {rows.map(([label, value]) => (
        <div key={label}>
          <Box variant='awsui-key-label'>{label}</Box>
          <Box fontSize='body-s'>{value ?? '—'}</Box>
        </div>
      ))}
    </ColumnLayout>
  )
}

function tagsBadges(tags?: Tag[]) {
  if (!tags || tags.length === 0) {
    return <Box color='text-status-inactive'>No tags</Box>
  }

  return (
    <SpaceBetween direction='horizontal' size='xs'>
      {tags.map((tag, index) => (
        <Badge key={tag.TagKey} color='grey'>
          {tag.TagKey}: {tag.TagValue}
        </Badge>
      ))}
    </SpaceBetween>
  )
}

function AliasesPanel({ id }: { id: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchKMSKeyAliases(id, activeEndpoint), [id, activeEndpoint])
  const { data } = useFetch<KMSKeyAlias[]>(fetcher)
  const aliases = data ?? []

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(aliases, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      resizableColumns={true}
      trackBy='name'
      variant='embedded'
      empty={
        <Box textAlign='center' padding='l' color='text-status-inactive'>
          No aliases exist yet
        </Box>
      }
      columnDefinitions={[
        {
          id: 'name',
          header: 'Alias Name',
          sortingField: 'aliasName',
          cell: item => item.aliasName
        },
        {
          id: 'alias_arn',
          header: 'Alias Arn',
          cell: item => item.aliasArn
        },
        {
          id: 'creation_date',
          header: 'Creation Date',
          sortingField: 'creationDate',
          cell: item => formatDate(item.creationDate)
        }
      ]}
      pagination={
        <Pagination {...paginationProps} />
      }
      loadingText='Loading Aliases'
      enableKeyboardNavigation
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder='Find Aliases'
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
    >

    </Table>
  )
}

function PolicyPanel({ id }: { id: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchKMSKeyPolicy(id, activeEndpoint), [id, activeEndpoint])
  const { data } = useFetch<object>(fetcher)

  return (
    !data ? (
      <Box color='text-status-inactive'>No key Policy</Box>
    ) : (
      <SpaceBetween size='xs'>
        <Box variant='code'>
          <pre className='whitespace-pre-wrap break-all text-xs'>{JSON.stringify(data, null, 2)}</pre>
        </Box>
      </SpaceBetween>
    )
  )
}

function GrantsPanel({ id }: { id: string }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchKMSKeyGrants(id, activeEndpoint), [id, activeEndpoint])
  const { data } = useFetch<KMSKeyGrant[]>(fetcher)
  const grants = data ?? []

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(grants, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  return (
    <Table
      {...collectionProps}
      items={items}
      resizableColumns={true}
      trackBy='id'
      variant='embedded'
      empty={
        <Box textAlign='center' padding='l' color='text-status-inactive'>
          No grants exist yet
        </Box>
      }
      columnDefinitions={[
        {
          id: 'id',
          header: 'Grant ID',
          sortingField: 'grantID',
          cell: item => item.grantID
        },
        {
          id: 'grantee',
          header: 'Grantee Arn',
          cell: item => item.grantee
        },
        {
          id: 'creation_date',
          header: 'Creation Date',
          sortingField: 'creationDate',
          cell: item => formatDate(item.creationDate)
        },
        {
          id: 'operations',
          header: 'Operations',
          cell: item => item.operations.join(',')
        }
      ]}
      pagination={
        <Pagination {...paginationProps} />
      }
      loadingText='Loading Grants'
      enableKeyboardNavigation
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder='Find Grants'
          countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
        />
      }
    >

    </Table>
  )

}

function KeyDetailModal({ id, onClose }: { id: string, onClose: () => void }) {
  const { activeEndpoint } = useEndpoint()
  const fetcher = useCallback(() => fetchKMSKeyDetail(id, activeEndpoint), [id, activeEndpoint])
  const { data } = useFetch<KMSKeyDetail>(fetcher)

  return (
    <Modal header={id} onDismiss={onClose} visible size='large'>
      {
        data && (
          <Tabs tabs={[
            {
              id: 'details',
              label: 'Details',
              content: kvGrid([
                ['Status', data.status],
                ['Expires at', data.expires_at],
                ['Description', data.description],
                ['Origin', data.origin],
                ['Rotation Period in Days', data.rotationStatus?.RotationPeriodInDays],
                ['Next Rotation Date', data.rotationStatus?.NextRotationDate],
                ['On Demand Rotation Start Date', data.rotationStatus?.OnDemandRotationStartDate]
              ])
            },
            {
              id: 'policy',
              label: 'Policy',
              content: <PolicyPanel id={id} />
            },
            {
              id: 'tags',
              label: 'Tags',
              content: tagsBadges(data.tags)
            },
            {
              id: 'grants',
              label: 'Grants',
              content: <GrantsPanel id={id} />
            },
            {
              id: 'aliases',
              label: 'Aliases',
              content: <AliasesPanel id={id}/>
            }
          ]}>
          </Tabs>
        )
      }
    </Modal>
  )
}

export function CloudscapeKMSBrowser() {
  const { activeEndpoint } = useEndpoint()
  const keysFetcher = useCallback(() => fetchKMSKeys(activeEndpoint), [activeEndpoint])
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get('id')
  const { data: keysData, loading: keysLoading, refresh: refreshKeys } = useFetch<{ keys: KMSKey[] }>(keysFetcher, 15000)
  const keys = keysData?.keys ?? []

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(keys, {
    filtering: {},
    pagination: { pageSize: 25 },
    sorting: {},
  })

  const closeModal = useCallback(() => setSearchParams({}), [setSearchParams])

  return (
    <SpaceBetween size='l'>
      <Table
        {...collectionProps}
        items={items}
        trackBy='id'
        variant='borderless'
        empty={
          <Box textAlign='center' padding='l' color='text-status-inactive'>
            No keys exist yet
          </Box>
        }
        header={
          <Header
            variant='h2'
            actions={<Button iconName='refresh' onClick={refreshKeys} loading={keysLoading} ariaLabel='Refresh Keys' />}
            counter={keys ? `(${keys.length})` : undefined}
          >
            <Box variant='h2' display='inline'>Keys</Box>
          </Header>
        }
        columnDefinitions={[
          {
            id: 'id',
            header: 'Key ID',
            sortingField: 'keyID',
            cell: item => <Link href={`?id=${encodeURIComponent(item.keyID)}`} onFollow={(event) => {
              event.preventDefault()
              setSearchParams({ id: item.keyID })
            }}>{item.keyID}</Link>
          },
          {
            id: 'arn',
            header: 'ARN',
            cell: item => item.keyArn
          },
          {
            id: 'creation_date',
            header: 'Creation Date',
            sortingField: 'creationDate',
            cell: item => formatDate(item.creationDate)
          },
          {
            id: 'usage',
            header: 'Key usage',
            cell: item => item.keyUsage
          },
          {
            id: 'spec',
            header: 'Key spec',
            sortingField: 'keySpec',
            cell: item => item.keySpec
          },
          {
            id: 'status',
            header: 'Status',
            cell: item => keyStateIndicator(item.status)
          }
        ]}
        enableKeyboardNavigation
        loadingText='Loading keys'
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder='Find Keys'
            countText={filteredItemsCount !== undefined ? `${filteredItemsCount} matches` : ''}
          />
        }
        pagination={
          <Pagination {...paginationProps} />
        }
      />
      {id && <KeyDetailModal id={id} onClose={closeModal} />}
    </SpaceBetween>
  )
}