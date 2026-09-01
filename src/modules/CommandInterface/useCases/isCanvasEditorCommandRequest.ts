import type { CanvasEditorCommandRequest } from './dispatchCanvasEditorCommand';

export function isCanvasEditorCommandRequest(value: unknown): value is CanvasEditorCommandRequest {
    return (
        typeof value === 'object' &&
        value !== null &&
        'action' in value &&
        typeof value.action === 'string' &&
        value.action.startsWith('edit:') &&
        'handled' in value &&
        typeof value.handled === 'boolean'
    );
}
