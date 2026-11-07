import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { findPendingRedoEntry } from './findPendingRedoEntry';
import { recordedRedoBindings } from './recordedRedoBindings';

/** Bind the exact materialized object to the pending request authenticated before admission. */
export function bindCanonicalRedoAction(
    requestedAction: AppAction,
    canonicalAction: AppAction,
    context: HandlerValidationContext['recordedRedo']
): void {
    if (!context || canonicalAction === requestedAction) {
        return;
    }
    const binding = recordedRedoBindings.contexts.get(context);
    if (!binding || binding.requestedAction !== requestedAction || !binding.isCurrent()) {
        return;
    }
    const existing = recordedRedoBindings.actions.get(canonicalAction);
    const pending = findPendingRedoEntry(canonicalAction);
    if ((existing && existing !== binding) || (pending && pending !== binding.entry)) {
        return;
    }
    recordedRedoBindings.actions.set(canonicalAction, binding);
}
