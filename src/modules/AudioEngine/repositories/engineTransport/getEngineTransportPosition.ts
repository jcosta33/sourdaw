import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { stoppedEngineTransportPosition, type EngineTransportPosition } from '../../models/EngineTransportPosition';

function readNumber(payload: Record<string, unknown>, key: keyof EngineTransportPosition): number {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toEngineTransportPosition(response: unknown): EngineTransportPosition {
    if (typeof response !== 'object' || response === null) {
        return stoppedEngineTransportPosition;
    }

    const payload = response as Record<string, unknown>;
    return {
        running: payload.running === true,
        playing: payload.playing === true,
        positionSeconds: readNumber(payload, 'positionSeconds'),
        playheadFrame: readNumber(payload, 'playheadFrame'),
        loopWraps: readNumber(payload, 'loopWraps'),
        batchesApplied: readNumber(payload, 'batchesApplied'),
        tempo: readNumber(payload, 'tempo'),
        timeSigNum: readNumber(payload, 'timeSigNum'),
        timeSigDenom: readNumber(payload, 'timeSigDenom'),
    };
}

/**
 * Read where the native engine's transport stands.
 *
 * A poll, not a subscription: the engine publishes its position once per audio
 * callback into a slot that keeps only the newest value, so reading it costs
 * one bridge round trip and never wakes the renderer. The caller therefore owns
 * the rate — UI rate, never audio-block rate.
 *
 * The browser build has no native engine and reports the stopped shape rather
 * than failing, so a caller polls with the same call on both platforms.
 */
export async function getEngineTransportPosition(): Promise<EngineTransportPosition> {
    if (!isDesktopRuntime()) {
        return stoppedEngineTransportPosition;
    }

    return toEngineTransportPosition(await desktopInvoke('engine_transport_position'));
}
