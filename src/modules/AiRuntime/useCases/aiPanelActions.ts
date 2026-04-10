/**
 * AI Panel Actions — local use cases wrapping cross-module calls
 * so that AiRuntime presentation views never import another module's
 * use cases directly.
 */
import { type RuntimeAction } from '../models/RuntimeAction';
import { executeAppAction, undo } from '#/modules/Command';
import { toggleChatPanel } from '#/modules/Workspace';

/** Execute an app action (delegates to Command module). */
export function runAppAction(action: RuntimeAction): Promise<void> | void {
    return executeAppAction(action);
}

/** Undo the last action (delegates to Command module). */
export function undoLastAction(): void {
    undo();
}

/** Toggle the chat panel (delegates to Workspace module). */
export function toggleChat(): void {
    toggleChatPanel();
}
