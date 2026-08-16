import { logger } from '#/infra/logger/appLogger';

import { getEngineRtDiagnostics } from '../../repositories/engineDiagnostics/getEngineRtDiagnostics';
import {
    clearEngineDiagnosticsReadFailure,
    shouldReportEngineDiagnosticsReadFailure,
} from '../../services/engineDiagnosticsReadFailureLatch';
import {
    defaultEngineRtDiagnosticsState,
    ENGINE_EVENT_HISTORY_LIMIT,
    engineRtDiagnosticsStore,
} from '../../stores/engineRtDiagnosticsStore';

import type { EngineRtDiagnostics } from '../../models/EngineRtDiagnostics';

/**
 * Read the native engine's real-time diagnostics and publish them.
 *
 * The command drains the engine's event ring, so the events it returns are
 * appended to what the store already holds — replacing them would throw away
 * every report made before this call.
 *
 * Each drained event is also logged at ingestion. The engine hands an event out
 * exactly once, so this reports it once. This is the app-level report, the one a
 * user can reach: the native drain in `daw-engine::engine_events` writes the
 * same event to stderr, which is the trace that survives when no webview is
 * attached to read it.
 *
 * Returns null when the read itself failed. The store is left untouched in that
 * case: a poll that could not reach the engine knows nothing, and publishing a
 * not-running shape for it would erase the last real reading and the event
 * history with it. A failure is logged once per distinct cause — the poll runs
 * every second, so reporting each one would bury the log.
 */
export async function refreshEngineRtDiagnostics(): Promise<EngineRtDiagnostics | null> {
    let diagnostics: EngineRtDiagnostics;
    try {
        diagnostics = await getEngineRtDiagnostics();
    } catch (error) {
        const message = String(error);
        if (shouldReportEngineDiagnosticsReadFailure(message)) {
            logger.error(new Error(`[AudioEngine] failed to read native engine diagnostics: ${message}`));
        }
        return null;
    }

    clearEngineDiagnosticsReadFailure();

    for (const event of diagnostics.events) {
        logger.warn(`[AudioEngine] native engine ${event.type}: ${event.kind}`);
    }

    engineRtDiagnosticsStore.update((state) => {
        const current = state ?? defaultEngineRtDiagnosticsState;
        const events = [...current.events, ...diagnostics.events];

        return {
            latest: diagnostics,
            events: events.slice(Math.max(0, events.length - ENGINE_EVENT_HISTORY_LIMIT)),
        };
    });

    return diagnostics;
}
