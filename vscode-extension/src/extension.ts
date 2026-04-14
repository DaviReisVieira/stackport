import * as vscode from 'vscode';
import { StackPortTreeProvider } from './treeView';
import { invokeLambdaCommand, sendSqsMessageCommand } from './commands';

export function activate(context: vscode.ExtensionContext) {
    console.log('StackPort extension is now active');

    const treeDataProvider = new StackPortTreeProvider();
    
    // Register the Tree View
    vscode.window.registerTreeDataProvider('stackport-explorer', treeDataProvider);

    // Register Refresh Command
    context.subscriptions.push(
        vscode.commands.registerCommand('stackport.refreshEntry', () => {
            treeDataProvider.refresh();
        })
    );

    // Register Detail Command
    context.subscriptions.push(
        vscode.commands.registerCommand('stackport.showResourceDetail', (item) => {
            vscode.window.showInformationMessage(`Resource ID: ${item.id}\n\n${JSON.stringify(item, null, 2)}`, { modal: true });
        })
    );

    // Register Quick Actions
    context.subscriptions.push(
        vscode.commands.registerCommand('stackport.invokeLambda', invokeLambdaCommand)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('stackport.sendSqsMessage', sendSqsMessageCommand)
    );
}

export function deactivate() {}
