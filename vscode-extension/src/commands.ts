import * as vscode from 'vscode';
import { StackPortApi } from './api';

const api = new StackPortApi();

export async function invokeLambdaCommand() {
    try {
        const { functions } = await api.fetchLambdaFunctions();
        if (functions.length === 0) {
            vscode.window.showInformationMessage('No Lambda functions found.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            functions.map(f => ({
                label: f.FunctionName,
                description: f.Runtime,
                detail: f.FunctionArn
            })),
            { placeHolder: 'Select a Lambda function to invoke' }
        );

        if (!selected) return;

        const payloadStr = await vscode.window.showInputBox({
            prompt: 'Enter JSON payload for invocation',
            value: '{}',
            validateInput: (value) => {
                try {
                    JSON.parse(value);
                    return null;
                } catch (e) {
                    return 'Invalid JSON';
                }
            }
        });

        if (payloadStr === undefined) return;

        const result = await api.invokeLambda(selected.label, JSON.parse(payloadStr));
        
        // Show result in a permanent output channel or a modal
        const output = vscode.window.createOutputChannel('StackPort: Lambda');
        output.show();
        output.appendLine(`Invocation Result for ${selected.label}:`);
        output.appendLine(`Status: ${result.statusCode}`);
        output.appendLine(`Payload: ${JSON.stringify(result.payload, null, 2)}`);
        if (result.logs) {
            output.appendLine('--- Logs ---');
            output.appendLine(result.logs);
        }

        vscode.window.showInformationMessage(`Lambda ${selected.label} invoked successfully.`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to invoke Lambda: ${err.message}`);
    }
}

export async function sendSqsMessageCommand() {
    try {
        const { queues } = await api.fetchSQSQueues();
        if (queues.length === 0) {
            vscode.window.showInformationMessage('No SQS queues found.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            queues.map(q => ({
                label: q.name,
                description: q.type,
                detail: q.url
            })),
            { placeHolder: 'Select an SQS queue' }
        );

        if (!selected) return;

        const messageBody = await vscode.window.showInputBox({
            prompt: 'Enter message body',
            placeHolder: 'Hello from VS Code!'
        });

        if (!messageBody) return;

        const result = await api.sendSqsMessage(selected.label, messageBody);
        vscode.window.showInformationMessage(`Message sent to ${selected.label}. ID: ${result.messageId}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send SQS message: ${err.message}`);
    }
}
