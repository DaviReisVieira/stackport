import * as vscode from 'vscode';

export interface ServiceStats {
    status: 'available' | 'unavailable';
    resources: Record<string, number>;
}

export interface StatsResponse {
    services: Record<string, ServiceStats>;
    total_resources: number;
    uptime_seconds: number;
}

export interface ResourceItem {
    id: string;
    [key: string]: any;
}

export interface ResourceListResponse {
    service: string;
    resources: Record<string, ResourceItem[]>;
}

export class StackPortApi {
    private get endpoint(): string {
        return vscode.workspace.getConfiguration('stackport').get('endpoint', 'http://localhost:8080');
    }

    async fetchStats(): Promise<StatsResponse> {
        const response = await fetch(`${this.endpoint}/api/stats`);
        if (!response.ok) {
            throw new Error(`Failed to fetch stats: ${response.statusText}`);
        }
        return await response.json() as StatsResponse;
    }

    async fetchResources(service: string): Promise<ResourceListResponse> {
        const response = await fetch(`${this.endpoint}/api/resources/${service}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch resources for ${service}: ${response.statusText}`);
        }
        return await response.json() as ResourceListResponse;
    }

    async fetchLambdaFunctions(): Promise<{ functions: any[] }> {
        const response = await fetch(`${this.endpoint}/api/lambda/functions`);
        if (!response.ok) {
            throw new Error(`Failed to fetch Lambda functions: ${response.statusText}`);
        }
        return await response.json() as { functions: any[] };
    }

    async invokeLambda(functionName: string, payload: any): Promise<any> {
        const response = await fetch(`${this.endpoint}/api/lambda/functions/${functionName}/invoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload })
        });
        if (!response.ok) {
            throw new Error(`Failed to invoke Lambda: ${response.statusText}`);
        }
        return await response.json();
    }

    async fetchSQSQueues(): Promise<{ queues: any[] }> {
        const response = await fetch(`${this.endpoint}/api/sqs/queues`);
        if (!response.ok) {
            throw new Error(`Failed to fetch SQS queues: ${response.statusText}`);
        }
        return await response.json() as { queues: any[] };
    }

    async sendSqsMessage(queueName: string, messageBody: string): Promise<any> {
        const response = await fetch(`${this.endpoint}/api/sqs/queues/${queueName}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageBody })
        });
        if (!response.ok) {
            throw new Error(`Failed to send SQS message: ${response.statusText}`);
        }
        return await response.json();
    }
}
