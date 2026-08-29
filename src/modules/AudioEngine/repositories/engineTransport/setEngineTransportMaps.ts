import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { type EngineTransportMaps, type EngineTransportMapsApplied } from '../../models/EngineTransportPosition';

export type SetEngineTransportMapsResult =
    | Readonly<{ outcome: 'applied'; applied: EngineTransportMapsApplied }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

function toApplied(response: unknown): EngineTransportMapsApplied | null {
    if (typeof response !== 'object' || response === null) {
        return null;
    }

    const payload = response as Record<string, unknown>;
    const sampleRate = payload.sampleRate;
    const tempoSegments = payload.tempoSegments;
    const timeSignatureSegments = payload.timeSignatureSegments;
    if (
        typeof sampleRate !== 'number' ||
        typeof tempoSegments !== 'number' ||
        typeof timeSignatureSegments !== 'number'
    ) {
        return null;
    }

    return {
        sampleRate,
        tempoSegments,
        timeSignatureSegments,
        loopEnabled: payload.loopEnabled === true,
    };
}

/**
 * Install the arrangement's tempo map, meter map and loop region on the native
 * engine.
 *
 * A separate command from the graph batch on purpose: the graph's
 * `set-transport` owns only playing and position (the transport ownership law
 * in `crates/sourdaw-native/src/commands/graph.rs`), and the maps have a
 * different owner that changes them on a different schedule. Sending them
 * through the topology batch would tie a tempo edit to a topology replacement.
 *
 * Declines rather than throws: there is no engine in a browser build, and on
 * the desktop the native side refuses when no engine is running. Both are
 * outcomes the caller carries on from, exactly as a declined live session is.
 */
export async function setEngineTransportMaps(maps: EngineTransportMaps): Promise<SetEngineTransportMapsResult> {
    if (!isDesktopRuntime()) {
        return { outcome: 'declined', reason: 'no desktop runtime' };
    }

    try {
        const applied = toApplied(await desktopInvoke('engine_transport_set_maps', { maps }));
        if (!applied) {
            return { outcome: 'declined', reason: 'the engine did not report what it applied' };
        }
        return { outcome: 'applied', applied };
    } catch (error) {
        return { outcome: 'declined', reason: error instanceof Error ? error.message : String(error) };
    }
}
