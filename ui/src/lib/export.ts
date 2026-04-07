// ui/src/lib/export.ts

/**
 * Converts a list of objects into a CSV string.
 * Handles nested objects by serializing them as JSON strings.
 */
export const convertToCSV = (data: any[]): string => {
    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const rows = data.map(obj =>
        headers.map(header => {
            const val = obj[header];
            const cell = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? "");
            // Escape quotes for CSV safety
            return `"${cell.replace(/"/g, '""')}"`;
        }).join(",")
    );

    return [headers.join(","), ...rows].join("\n");
};

/**
 * Triggers a browser download for the given content.
 */
export const downloadFile = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const handleExport = (data: any[], format: 'json' | 'csv', service: string, resource: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `stackport-${service}-${resource}-${timestamp}.${format}`;

    if (format === 'json') {
        downloadFile(JSON.stringify(data, null, 2), filename, "application/json");
    } else {
        downloadFile(convertToCSV(data), filename, "text/csv");
    }
};