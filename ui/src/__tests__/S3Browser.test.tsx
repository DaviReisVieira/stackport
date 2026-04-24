import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { S3Browser } from '@/components/service-views/S3Browser'
import { TooltipProvider } from '@/components/ui/tooltip'

const sampleFile = {
  key: 'readme.txt',
  name: 'readme.txt',
  size: 10,
  content_type: 'text/plain',
  etag: 'x',
  last_modified: '2020-01-01T00:00:00',
}

const defaultObjectsResponse = {
  bucket: 'my-bucket',
  prefix: '',
  delimiter: '/',
  folders: [] as string[],
  files: [] as (typeof sampleFile)[],
}

const { uploadS3ObjectMock, fetchS3ObjectsMock, deleteS3ObjectMock } = vi.hoisted(() => ({
  uploadS3ObjectMock: vi.fn(() =>
    Promise.resolve({
      bucket: 'my-bucket',
      key: 'test.txt',
      size: 1,
      content_type: 'text/plain',
    }),
  ),
  fetchS3ObjectsMock: vi.fn(() => Promise.resolve({ ...defaultObjectsResponse })),
  deleteS3ObjectMock: vi.fn(() =>
    Promise.resolve({ bucket: 'my-bucket', deleted: true, key: 'readme.txt' }),
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  fetchS3Buckets: vi.fn(() =>
    Promise.resolve({
      buckets: [
        {
          name: 'my-bucket',
          created: '2020-01-01T00:00:00',
          region: 'us-east-1',
          object_count: 0,
          total_size: 0,
          versioning: 'Disabled',
          encryption: 'Disabled',
          tags: {},
        },
      ],
    }),
  ),
  fetchS3Objects: fetchS3ObjectsMock,
  fetchS3Object: vi.fn(),
  getS3DownloadUrl: vi.fn(() => '/api/s3/buckets/my-bucket/objects/x'),
  uploadS3Object: uploadS3ObjectMock,
  deleteS3Object: deleteS3ObjectMock,
  deleteS3ObjectsBatch: vi.fn(),
  createS3Folder: vi.fn(),
  fetchS3UploadConfig: vi.fn(() => Promise.resolve({ max_upload_bytes: 104857600 })),
  fetchResourceTags: vi.fn(() => Promise.resolve({ tags: {} })),
  updateResourceTags: vi.fn(() => Promise.resolve({ success: true })),
}))

function renderWithBucket(search = '?bucket=my-bucket') {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/resources/s3${search}`]}>
        <Routes>
          <Route path="/resources/s3" element={<S3Browser />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  fetchS3ObjectsMock.mockImplementation(() => Promise.resolve({ ...defaultObjectsResponse }))
  uploadS3ObjectMock.mockImplementation(() =>
    Promise.resolve({
      bucket: 'my-bucket',
      key: 'test.txt',
      size: 1,
      content_type: 'text/plain',
    }),
  )
})

describe('S3Browser toolbar', () => {
  it('renders an Upload control in the object browser', async () => {
    renderWithBucket()

    await waitFor(() => {
      expect(screen.getByTestId('s3-object-drop-zone')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })
})

describe('S3Browser drag-and-drop', () => {
  it('calls uploadS3Object when a file is dropped on the object list zone', async () => {
    uploadS3ObjectMock.mockClear()

    renderWithBucket()

    await waitFor(() => {
      expect(screen.getByTestId('s3-object-drop-zone')).toBeInTheDocument()
    })

    const zone = screen.getByTestId('s3-object-drop-zone')
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    const dt = {
      files: [file],
      types: ['Files'],
      items: { length: 1 },
    } as unknown as DataTransfer

    fireEvent.dragEnter(zone, {
      dataTransfer: dt,
    })

    fireEvent.drop(zone, {
      dataTransfer: dt,
    })

    await waitFor(() => {
      expect(uploadS3ObjectMock).toHaveBeenCalledTimes(1)
    })

    expect(uploadS3ObjectMock).toHaveBeenCalledWith(
      'my-bucket',
      expect.objectContaining({ name: 'test.txt' }),
      '',
      expect.any(Object),
    )
  })
})

describe('S3Browser delete confirmation', () => {
  it('opens confirm dialog and calls deleteS3Object when deleting a file', async () => {
    const user = userEvent.setup()
    fetchS3ObjectsMock.mockResolvedValue({
      ...defaultObjectsResponse,
      files: [sampleFile],
    })
    deleteS3ObjectMock.mockClear()

    renderWithBucket()

    await screen.findByText('readme.txt')

    await user.click(screen.getByRole('button', { name: /delete readme\.txt/i }))

    const dialog = await screen.findByRole('dialog', { name: /confirm delete/i })
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(deleteS3ObjectMock).toHaveBeenCalledWith('my-bucket', 'readme.txt', null)
    })
  })
})

describe('S3Browser upload progress', () => {
  it('shows the uploading dialog for files larger than 1MB', async () => {
    const user = userEvent.setup()
    uploadS3ObjectMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                bucket: 'my-bucket',
                key: 'big.bin',
                size: 2 * 1024 * 1024,
                content_type: 'application/octet-stream',
              }),
            150,
          ),
        ),
    )

    renderWithBucket()

    await waitFor(() => {
      expect(screen.getByTestId('s3-object-drop-zone')).toBeInTheDocument()
    })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.bin', {
      type: 'application/octet-stream',
    })
    await user.upload(input, big)

    await waitFor(() => {
      expect(screen.getByText('Uploading')).toBeInTheDocument()
      expect(screen.getByText('big.bin')).toBeInTheDocument()
    })
  })
})
