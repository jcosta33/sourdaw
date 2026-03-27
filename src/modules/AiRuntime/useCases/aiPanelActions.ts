/**
 * AI Panel Actions — local use cases wrapping cross-module calls
 * so that AiRuntime presentation views never import another module's
 * use cases directly.
 */

import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';

export type { AppAction };
import { undo } from '#/modules/Command/useCases/undoRedo';
import { toggleChatPanel } from '#/modules/Workspace/useCases/togglePanel/panelToggles';

/** Execute an app action (delegates to Command module). */
export function runAppAction(action: AppAction): Promise<void> | void {
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
