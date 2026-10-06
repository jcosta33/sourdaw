/**
 * Cancel + lock state for offline renders. Wrapped in a holder so HMR
 * replacement creates a fresh state object and in-flight renders keep
 * operating on the closed-over reference they started with.
 *
 * The controller is the flag's abortable half (#4440): a render that owns
 * cancellation begins a scope, threads the scope's signal down to the work
 * only it is doing, and `cancelExport` both raises the flag and aborts the
 * scope — so an awaited fetch inside instrument setup can stop at the moment
 * of cancellation rather than at the next `checkCancel()` between tracks. The
 * scope closes when the export settles (`endExportCancellationScope`), so a
 * cancelled export's flag never outlives its render (#4782). Freeze and
 * bounce begin no scope and read none of this state: they stop only on a
 * caller's own `abortSignal`.
 */
type RenderCoordination = {
    cancelFlag: boolean;
    isRenderingActive: boolean;
    controller: AbortController;
};

export const exportCancellationState: RenderCoordination = {
    cancelFlag: false,
    isRenderingActive: false,
    controller: new AbortController(),
};
