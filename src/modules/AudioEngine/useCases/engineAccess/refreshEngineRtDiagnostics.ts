import { getEngineRtDiagnostics } from '../../repositories/engineDiagnostics/getEngineRtDiagnostics';
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
 */
export async function refreshEngineRtDiagnostics(): Promise<EngineRtDiagnostics> {
    const diagnostics = await getEngineRtDiagnostics();

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
