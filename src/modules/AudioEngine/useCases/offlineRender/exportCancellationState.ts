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
 *
 * The render lock records who holds it (#4768, #5036). A musician's export
 * outranks every agent render, a measurement or a section render: it stops the
 * render through `preempt` and takes the lock once `released` settles, while
 * `queuedMusicianExport` marks that claim so no other render can slip in
 * between. Agent renders never preempt one another.
 */
export type AgentRenderHolder = 'agent-measurement' | 'agent-section-render';

export type RenderLockHolder = 'musician-export' | AgentRenderHolder;

type RenderLock = {
    holder: RenderLockHolder;
    /** Stops the holder's render. Only an agent render has one; a musician's export is never preempted. */
    preempt: (() => void) | null;
    /** Settles once the holder has released the lock. */
    released: Promise<void>;
    settleReleased: () => void;
};

type RenderCoordination = {
    cancelFlag: boolean;
    renderLock: RenderLock | null;
    /** A musician's export waiting for an agent render to release; aborted by `cancelExport`. */
    queuedMusicianExport: AbortController | null;
    controller: AbortController;
};

export const exportCancellationState: RenderCoordination = {
    cancelFlag: false,
    renderLock: null,
    queuedMusicianExport: null,
    controller: new AbortController(),
};
