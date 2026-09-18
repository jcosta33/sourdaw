import { type AppActionType } from '#/utils/handlerContract';

import { getHandlerByType } from '../stores/handlerRegistry';

/**
 * Whether the registered handler for an action type is certified to execute
 * inside an isolated project preview.
 *
 * `previewVersionedCommandBatchEnvelope` admits a batch only when every
 * handler declares `isolated-project`, so `unknown` — an unregistered handler,
 * or one that never made the declaration — is as unpreviewable as an explicit
 * `unsupported-external`, and is reported apart from it so a caller can tell a
 * wiring gap from a stated external boundary.
 */
export function getAppActionPreviewExecution(
    actionType: AppActionType
): 'isolated-project' | 'unsupported-external' | 'unknown' {
    const handler = getHandlerByType(actionType);
    if (!handler) {
        return 'unknown';
    }
    return handler.previewExecution ?? 'unknown';
}
