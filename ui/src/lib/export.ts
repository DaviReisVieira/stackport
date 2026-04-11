export type ExportFormat = 'json' | 'csv';

export interface ExportOptions {
  service: string;
  resourceType: string;
  data: Record<string, unknown>[];
  format: ExportFormat;
}

function generateFilename(service: string, resourceType: string, format: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `stackport-${service}-${resourceType}-${timestamp}.${format}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToJSON(options: ExportOptions): void {
  const { service, resourceType, data } = options;
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = generateFilename(service, resourceType, 'json');
  downloadBlob(blob, filename);
}

function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str: string;
  if (typeof value === 'object') {
    // Serialize objects/arrays as JSON strings
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function exportToCSV(options: ExportOptions): void {
  const { service, resourceType, data } = options;

  if (data.length === 0) {
    throw new Error('No data to export');
  }

  // Extract all unique column names from all rows
  const columnSet = new Set<string>();
  data.forEach(row => {
    Object.keys(row).forEach(key => columnSet.add(key));
  });
  const columns = Array.from(columnSet).sort();

  // Build CSV
  const rows: string[] = [];

  // Header row
  rows.push(columns.map(col => escapeCSVValue(col)).join(','));

  // Data rows
  data.forEach(row => {
    const values = columns.map(col => escapeCSVValue(row[col]));
    rows.push(values.join(','));
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const filename = generateFilename(service, resourceType, 'csv');
  downloadBlob(blob, filename);
}

export function exportData(options: ExportOptions): void {
  if (options.format === 'json') {
    exportToJSON(options);
  } else if (options.format === 'csv') {
    exportToCSV(options);
  } else {
    throw new Error(`Unsupported export format: ${options.format}`);
  }
}
