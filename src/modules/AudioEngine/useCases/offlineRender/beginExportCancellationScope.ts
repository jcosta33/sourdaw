import { exportCancellationState } from './exportCancellationState';

/**
 * Begin a render's cancellation scope and return its signal (#4440).
 *
 * A render that owns user cancellation — the mixdown and the stem set — calls
 * this at its start, and threads the returned signal into the strip and
 * device-chain builds so instrument preparation can abort at the moment
 * `cancelExport` fires instead of running to completion or its 30-second
 * deadline. The signal is captured once, at scope start: it names exactly this
 * render, never whatever render a later reset installed. The scope closes in
 * the export's own settle path (`endExportCancellationScope`), so a cancelled
 * render's flag never outlives it (#4782).
 *
 * Renders that never begin a scope (the freeze path) see no signal at all and
 * keep the deadline-only backstop `runOfflineInstrumentSetup` always applies.
 */
export function beginExportCancellationScope(): AbortSignal {
    exportCancellationState.cancelFlag = false;
    exportCancellationState.controller = new AbortController();
    return exportCancellationState.controller.signal;
}
