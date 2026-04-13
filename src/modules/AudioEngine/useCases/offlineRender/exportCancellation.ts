import { createExportError } from '../../errors/ExportError';

/**
 * Cancel + lock state for offline renders. Wrapped in a holder so HMR
 * replacement creates a fresh state object and in-flight renders keep
 * operating on the closed-over reference they started with.
 */
type RenderCoordination = {
    cancelFlag: boolean;
    isRenderingActive: boolean;
};

const state: RenderCoordination = {
    cancelFlag: false,
    isRenderingActive: false,
};

export function cancelExport(): void {
    state.cancelFlag = true;
}

export function resetCancelFlag(): void {
    state.cancelFlag = false;
}

export function isCancelRequested(): boolean {
    return state.cancelFlag;
}

/** Throws if a cancel was requested. */
export function checkCancel(): void {
    if (state.cancelFlag) {
        throw createExportError('Export cancelled');
    }
}

/**
 * Whether a render (mixdown or stems) is currently in progress.
 * Consumers can read this to prevent a second export from being triggered.
 */
export function isExportActive(): boolean {
    return state.isRenderingActive;
}

/**
 * Acquires the render lock. Throws if another render is already running.
 * Returns a release function that MUST be called in a finally block.
 */
export function acquireRenderLock(): () => void {
    if (state.isRenderingActive) {
        throw createExportError(
            'An export is already in progress. Cancel the current export before starting a new one.'
        );
    }
    state.isRenderingActive = true;
    return () => {
        state.isRenderingActive = false;
    };
}
