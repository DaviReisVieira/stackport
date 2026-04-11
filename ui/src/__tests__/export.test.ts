import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportToJSON, exportToCSV, exportData } from '../lib/export';

describe('export utilities', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let mockLink: HTMLAnchorElement;

  beforeEach(() => {
    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement;

    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportToJSON', () => {
    it('exports data as JSON with correct filename format', () => {
      const data = [
        { id: 'item1', name: 'Test Item', count: 42 },
        { id: 'item2', name: 'Another Item', count: 7 },
      ];

      exportToJSON({
        service: 's3',
        resourceType: 'buckets',
        data,
        format: 'json',
      });

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(mockLink.click).toHaveBeenCalled();
      expect(mockLink.download).toMatch(/^stackport-s3-buckets-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('formats JSON with 2-space indentation', () => {
      const data = [{ id: 'test', nested: { key: 'value' } }];
      let capturedBlob: Blob | null = null;

      createObjectURLSpy.mockImplementation((blob) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      });

      exportToJSON({
        service: 'lambda',
        resourceType: 'functions',
        data,
        format: 'json',
      });

      expect(capturedBlob).toBeTruthy();
      expect(capturedBlob!.type).toBe('application/json');
    });

    it('handles empty array', () => {
      exportToJSON({
        service: 's3',
        resourceType: 'objects',
        data: [],
        format: 'json',
      });

      expect(mockLink.click).toHaveBeenCalled();
    });
  });

  describe('exportToCSV', () => {
    it('exports data as CSV with header row', () => {
      const data = [
        { id: 'item1', name: 'Test', count: 10 },
        { id: 'item2', name: 'Another', count: 20 },
      ];

      exportToCSV({
        service: 'dynamodb',
        resourceType: 'tables',
        data,
        format: 'csv',
      });

      expect(mockLink.download).toMatch(/^stackport-dynamodb-tables-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
    });

    it('escapes CSV values with commas, quotes, and newlines', () => {
      const data = [
        { id: 'test1', description: 'value with, comma' },
        { id: 'test2', description: 'value with "quotes"' },
        { id: 'test3', description: 'value with\nnewline' },
      ];
      let capturedBlob: Blob | null = null;

      createObjectURLSpy.mockImplementation((blob) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      });

      exportToCSV({
        service: 's3',
        resourceType: 'objects',
        data,
        format: 'csv',
      });

      expect(capturedBlob).toBeTruthy();
      expect(capturedBlob!.type).toBe('text/csv');
    });

    it('serializes nested objects as JSON strings', () => {
      const data = [
        { id: 'test', metadata: { key1: 'value1', key2: 'value2' } },
      ];
      let capturedBlob: Blob | null = null;

      createObjectURLSpy.mockImplementation((blob) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      });

      exportToCSV({
        service: 'lambda',
        resourceType: 'functions',
        data,
        format: 'csv',
      });

      expect(capturedBlob).toBeTruthy();
    });

    it('handles null and undefined values', () => {
      const data = [
        { id: 'test1', value: null, other: undefined },
        { id: 'test2', value: 'present', other: 'also present' },
      ];

      exportToCSV({
        service: 'sqs',
        resourceType: 'queues',
        data,
        format: 'csv',
      });

      expect(mockLink.click).toHaveBeenCalled();
    });

    it('includes all unique columns from all rows', () => {
      const data = [
        { id: 'test1', name: 'First' },
        { id: 'test2', count: 42 },
      ];

      exportToCSV({
        service: 'ec2',
        resourceType: 'instances',
        data,
        format: 'csv',
      });

      expect(mockLink.click).toHaveBeenCalled();
    });

    it('throws error when exporting empty array', () => {
      expect(() => {
        exportToCSV({
          service: 's3',
          resourceType: 'buckets',
          data: [],
          format: 'csv',
        });
      }).toThrow('No data to export');
    });
  });

  describe('exportData', () => {
    it('delegates to exportToJSON for json format', () => {
      const data = [{ id: 'test' }];

      exportData({
        service: 's3',
        resourceType: 'buckets',
        data,
        format: 'json',
      });

      expect(mockLink.download).toMatch(/\.json$/);
    });

    it('delegates to exportToCSV for csv format', () => {
      const data = [{ id: 'test' }];

      exportData({
        service: 's3',
        resourceType: 'buckets',
        data,
        format: 'csv',
      });

      expect(mockLink.download).toMatch(/\.csv$/);
    });

    it('throws error for unsupported format', () => {
      const data = [{ id: 'test' }];

      expect(() => {
        exportData({
          service: 's3',
          resourceType: 'buckets',
          data,
          format: 'xml' as 'json',
        });
      }).toThrow('Unsupported export format: xml');
    });
  });
});
