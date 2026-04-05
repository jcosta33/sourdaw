/**
 * AI Panel Actions — local use cases wrapping cross-module calls
 * so that AiRuntime presentation views never import another module's
 * use cases directly.
 */

import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { undo } from '#/modules/Command/useCases/undoRedo';
import { toggleChatPanel } from '#/modules/Workspace/useCases/togglePanel/panelToggles';

// AiRuntime-local shape (AGENTS.md §95 — derive from Command's public use-case signature
// rather than importing the AppAction union directly). Passed through opaquely.
type AppAction = Parameters<typeof executeAppAction>[0];

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
