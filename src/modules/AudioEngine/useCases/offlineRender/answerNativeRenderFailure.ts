import { createExportError } from '../../errors/ExportError';
import { isNativeOfflineRenderCancelled } from '../../repositories/nativeGraph/isNativeOfflineRenderCancelled';
import { isNativeOfflineRenderHeadPastCeiling } from '../../repositories/nativeGraph/isNativeOfflineRenderHeadPastCeiling';

import { checkCancel } from './checkCancel';

/**
 * What a failed native render throws: the export's own `Export cancelled` when
 * this export's cancel stopped it — the flag or signal `checkCancel` reads, or
 * the native side's own cancelled refusal — and the failure itself otherwise.
 */
function nativeRenderFailure(error: unknown, abortSignal: AbortSignal | undefined): unknown {
    checkCancel(abortSignal);
    return isNativeOfflineRenderCancelled(error) ? createExportError('Export cancelled', error) : error;
}

/**
 * The answer to a failed native render. A render the engine refused because
 * the compensation head it renders ahead of the requested frames takes it past
 * its frame ceiling declines: the selection gate cannot see that head, so this
 * is the ceiling law's own fallback, not a failure. Every other failure throws
 * through {@link nativeRenderFailure}.
 */
export function answerNativeRenderFailure(
    error: unknown,
    abortSignal: AbortSignal | undefined
): Readonly<{ outcome: 'declined'; reason: string }> {
    if (!isNativeOfflineRenderHeadPastCeiling(error)) {
        throw nativeRenderFailure(error, abortSignal);
    }
    checkCancel(abortSignal);
    return {
        outcome: 'declined',
        reason: "its printed compensation head takes it past the native render's frame ceiling",
    };
}
