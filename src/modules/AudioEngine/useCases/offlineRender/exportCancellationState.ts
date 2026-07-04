/**
 * Cancel + lock state for offline renders. Wrapped in a holder so HMR
 * replacement creates a fresh state object and in-flight renders keep
 * operating on the closed-over reference they started with.
 */
type RenderCoordination = {
    cancelFlag: boolean;
    isRenderingActive: boolean;
};

export const exportCancellationState: RenderCoordination = {
    cancelFlag: false,
    isRenderingActive: false,
};
