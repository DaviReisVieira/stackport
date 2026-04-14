import * as vscode from 'vscode';
import { StackPortApi, ServiceStats, ResourceItem } from './api';

export class StackPortTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private api: StackPortApi;

    constructor() {
        this.api = new StackPortApi();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        try {
            if (!element) {
                // Root: fetch all services
                const stats = await this.api.fetchStats();
                return Object.entries(stats.services).map(([name, data]) => 
                    new ServiceTreeItem(name, data)
                );
            }

            if (element instanceof ServiceTreeItem) {
                if (element.data.status === 'unavailable') {
                    return [];
                }
                // Fetch full resource list for this service
                const resources = await this.api.fetchResources(element.label as string);
                return Object.entries(resources.resources).map(([type, items]) => 
                    new ResourceTypeTreeItem(element.label as string, type, items)
                );
            }

            if (element instanceof ResourceTypeTreeItem) {
                return element.items.map(item => new ResourceTreeItem(item));
            }

            return [];
        } catch (err: any) {
            vscode.window.showErrorMessage(`StackPort: ${err.message}`);
            return [];
        }
    }
}

type TreeItem = ServiceTreeItem | ResourceTypeTreeItem | ResourceTreeItem;

class ServiceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly data: ServiceStats
    ) {
        super(label, data.status === 'available' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        
        const totalResources = Object.values(data.resources).reduce((a, b) => a + b, 0);
        this.description = data.status === 'available' ? `${totalResources} resources` : '(unavailable)';
        this.tooltip = `${label} - ${data.status}`;
        this.contextValue = 'service';
        
        if (data.status === 'available') {
            this.iconPath = new vscode.ThemeIcon('cloud');
        } else {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        }
    }
}

class ResourceTypeTreeItem extends vscode.TreeItem {
    constructor(
        public readonly service: string,
        public readonly type: string,
        public readonly items: ResourceItem[]
    ) {
        super(type, items.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = `${items.length}`;
        this.tooltip = `${service} ${type}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'resourceType';
    }
}

class ResourceTreeItem extends vscode.TreeItem {
    constructor(public readonly item: ResourceItem) {
        super(item.id, vscode.TreeItemCollapsibleState.None);
        this.tooltip = JSON.stringify(item, null, 2);
        this.iconPath = new vscode.ThemeIcon('symbol-interface');
        this.contextValue = 'resource';
        
        // Command to show detail (optional for now)
        this.command = {
            command: 'stackport.showResourceDetail',
            title: 'Show Detail',
            arguments: [item]
        };
    }
}
