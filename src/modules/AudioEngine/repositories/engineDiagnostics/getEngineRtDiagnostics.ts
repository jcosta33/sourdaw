import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import {
    notRunningEngineRtDiagnostics,
    type EngineEvent,
    type EngineRtDiagnostics,
    type EngineStreamErrorKind,
} from '../../models/EngineRtDiagnostics';

const streamErrorKinds: readonly EngineStreamErrorKind[] = [
    'deviceNotAvailable',
    'deviceBusy',
    'deviceChanged',
    'streamInvalidated',
    'xrun',
    'backendSpecific',
];

function readCounter(payload: Record<string, unknown>, key: keyof EngineRtDiagnostics): number {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toEngineEvent(value: unknown): EngineEvent | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (candidate.type !== 'streamError') {
        // The event union is hand-mirrored from Rust, so a `type` this build
        // does not know means the native side grew a variant this one never
        // learned. Dropping it silently would make that drift invisible; the
        // raw entry is logged so the unmapped shape is readable.
        logger.warn(`[AudioEngine] unrecognized engine event: ${JSON.stringify(candidate)}`);
        return null;
    }

    const kind = candidate.kind;
    if (typeof kind !== 'string' || !streamErrorKinds.includes(kind as EngineStreamErrorKind)) {
        // An unmapped kind still means the stream errored — report it rather
        // than dropping the event, which is the failure this surface exists to
        // end.
        return { type: 'streamError', kind: 'backendSpecific' };
    }

    return { type: 'streamError', kind: kind as EngineStreamErrorKind };
}

function toEngineRtDiagnostics(response: unknown): EngineRtDiagnostics {
    if (typeof response !== 'object' || response === null) {
        return notRunningEngineRtDiagnostics;
    }

    const payload = response as Record<string, unknown>;
    const events = Array.isArray(payload.events)
        ? payload.events.flatMap((entry) => {
              const event = toEngineEvent(entry);
              return event ? [event] : [];
          })
        : [];

    return {
        running: payload.running === true,
        schedulerEventBufferOverflows: readCounter(payload, 'schedulerEventBufferOverflows'),
        arpeggiatorActiveNoteExhaustions: readCounter(payload, 'arpeggiatorActiveNoteExhaustions'),
        effectIdCollisions: readCounter(payload, 'effectIdCollisions'),
        unsupportedEffectAdditions: readCounter(payload, 'unsupportedEffectAdditions'),
        unmappedSetParamCalls: readCounter(payload, 'unmappedSetParamCalls'),
        bridgeOutputBlocksDropped: readCounter(payload, 'bridgeOutputBlocksDropped'),
        unmatchedBridgeBlocks: readCounter(payload, 'unmatchedBridgeBlocks'),
        bridgeBacklogBlocksShed: readCounter(payload, 'bridgeBacklogBlocksShed'),
        callbackFramesOverBridgeReach: readCounter(payload, 'callbackFramesOverBridgeReach'),
        bridgeInputBlocksRefused: readCounter(payload, 'bridgeInputBlocksRefused'),
        events,
    };
}

/**
 * Read the native engine's real-time diagnostics.
 *
 * The browser build has no native engine, so it reports the not-running shape
 * rather than failing. On the desktop the command can still reject — a poisoned
 * engine mutex is one way — so the caller polls with the same call on both
 * platforms but must own the rejection.
 */
export async function getEngineRtDiagnostics(): Promise<EngineRtDiagnostics> {
    if (!isTauri()) {
        return notRunningEngineRtDiagnostics;
    }

    return toEngineRtDiagnostics(await tauriInvoke('engine_rt_diagnostics'));
}
