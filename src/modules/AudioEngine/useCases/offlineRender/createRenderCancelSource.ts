import { createExportError } from '../../errors/ExportError';

import { isCancelRequested } from './isCancelRequested';
import { type RenderCancelSource } from './renderInSegments';

/**
 * What stops a segmented render that owns an `abortSignal`: the export cancel flag, as for every
 * mixdown, or that signal. Without a signal the render keeps the kernel's default source.
 */
export function createRenderCancelSource(abortSignal: AbortSignal | undefined): RenderCancelSource | undefined {
    if (abortSignal === undefined) {
        return undefined;
    }
    return {
        isCancelled: () => isCancelRequested() || abortSignal.aborted,
        createCancelError: () => createExportError('Export cancelled'),
    };
}
