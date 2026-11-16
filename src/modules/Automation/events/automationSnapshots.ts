/** A captured automation point, carried by the `restoreAutomationLanePoints` inverse
 *  action and by clip-scoped lane snapshots. A structural mirror of the
 *  `AutomationPoint` model, which never crosses the module boundary, so this
 *  specifies only the fields a transform-undo round-trips. */
export type AutomationPointSnapshot = {
    readonly id?: string;
    readonly beat: number;
    readonly value: number;
    readonly curve: string;
    readonly tension: number;
    readonly stairSteps?: number;
    readonly cp1?: { readonly x: number; readonly y: number };
    readonly cp2?: { readonly x: number; readonly y: number };
};

/**
 * Content-bound authority over gesture automation recording for one static
 * parameter edit. A fader ride and a model-proposed "set this parameter" reach
 * the same setter, and the setter decides from live transport and automation
 * mode alone — so an edit issued while the transport plays in write/touch/latch
 * would open or extend a recording pass and let the next loop wrap or stop
 * flush it over the lane. `'suppressed'` travels with the command's own
 * arguments (runtime schema, digest, content hash, persisted undo entry) so the
 * decision cannot drift from the edit it belongs to, and so undo, redo and
 * replay of that edit stay equally silent. Absent means the ordinary manual
 * gesture behaviour.
 */
export type AutomationRecordingPolicy = 'suppressed';
