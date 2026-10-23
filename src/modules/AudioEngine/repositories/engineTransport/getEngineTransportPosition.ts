import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import {
    stoppedEngineTransportPosition,
    type EngineTransportPosition,
    type NativeTunerReading,
    type EngineCaptureClock,
    type EngineCaptureClockQuery,
} from '../../models/EngineTransportPosition';

function readNumber(payload: Record<string, unknown>, key: keyof EngineTransportPosition): number {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Keep only the strip peaks that are actually finite numbers, on their own
 * keys — a payload from an untrusted bridge call gets no benefit of the
 * doubt, and a malformed or missing entry is dropped rather than coerced.
 */
function readStripPeaks(payload: Record<string, unknown>): Readonly<Record<string, number>> {
    const raw = payload.stripPeaks;
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }

    const peaks: Record<string, number> = {};
    for (const [trackId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            peaks[trackId] = value;
        }
    }
    return peaks;
}

/**
 * Keep only the tuner readings that carry a whole, well-formed detection,
 * on their own keys.
 *
 * The same law [readStripPeaks] applies, for the same reason: nothing from a
 * bridge call is trusted, and an entry missing a field or carrying a
 * non-finite one is dropped whole rather than filled in. A partly coerced
 * reading would put a number in front of the musician that no analyser
 * computed — worse than showing no reading at all, because the needle cannot
 * say which of its fields it made up.
 *
 * `active` is read as a boolean rather than truthiness so a malformed entry
 * cannot present itself as a live detection.
 */
function readTunerTelemetry(payload: Record<string, unknown>): Readonly<Record<string, NativeTunerReading>> {
    const raw = payload.tunerTelemetry;
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }

    const readings: Record<string, NativeTunerReading> = {};
    for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
        const reading = asTunerReading(value);
        if (reading !== null) {
            readings[deviceId] = reading;
        }
    }
    return readings;
}

/** A finite number as itself, and `null` for anything else. */
function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveEpoch(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readCaptureClock(value: unknown): EngineCaptureClock | null {
    const clock = record(value);
    if (!clock || !positiveEpoch(clock.epoch) || !positiveEpoch(clock.streamEpoch)) {
        return null;
    }
    const sampleRate = finiteNumber(clock.sampleRate);
    const presentationSeconds = finiteNumber(clock.presentationSeconds);
    const uncertaintySeconds = clock.uncertaintySeconds === null ? null : finiteNumber(clock.uncertaintySeconds);
    if (
        sampleRate === null ||
        sampleRate <= 0 ||
        presentationSeconds === null ||
        presentationSeconds < 0 ||
        (clock.quality !== 'estimated' && clock.quality !== 'degraded') ||
        (clock.uncertaintySeconds !== null && (uncertaintySeconds === null || uncertaintySeconds < 0))
    ) {
        return null;
    }
    return {
        epoch: clock.epoch,
        streamEpoch: clock.streamEpoch,
        sampleRate,
        presentationSeconds,
        quality: clock.quality,
        uncertaintySeconds,
    };
}

function readCaptureClockQuery(value: unknown): EngineCaptureClockQuery | null {
    const query = record(value);
    if (!query || !positiveEpoch(query.epoch)) {
        return null;
    }
    const enteredSeconds = finiteNumber(query.enteredSeconds);
    const leavingSeconds = finiteNumber(query.leavingSeconds);
    if (enteredSeconds === null || enteredSeconds < 0 || leavingSeconds === null || leavingSeconds < enteredSeconds) {
        return null;
    }
    return { epoch: query.epoch, enteredSeconds, leavingSeconds };
}

/** One payload entry as a reading, or `null` when any part of it is unusable. */
function asTunerReading(value: unknown): NativeTunerReading | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Record<string, unknown>;
    const frequency = finiteNumber(entry.frequency);
    const cents = finiteNumber(entry.cents);
    const confidence = finiteNumber(entry.confidence);
    const noteIndex = finiteNumber(entry.noteIndex);
    const octave = finiteNumber(entry.octave);
    const midiNote = finiteNumber(entry.midiNote);
    if (
        typeof entry.active !== 'boolean' ||
        frequency === null ||
        cents === null ||
        confidence === null ||
        noteIndex === null ||
        octave === null ||
        midiNote === null
    ) {
        return null;
    }

    return { active: entry.active, frequency, cents, confidence, noteIndex, octave, midiNote };
}

function toEngineTransportPosition(response: unknown): EngineTransportPosition {
    if (typeof response !== 'object' || response === null) {
        return stoppedEngineTransportPosition;
    }

    const payload = response as Record<string, unknown>;
    const captureClockQuery = readCaptureClockQuery(payload.captureClockQuery);
    const captureClock = readCaptureClock(payload.captureClock);
    return {
        captureClock: captureClock?.epoch === captureClockQuery?.epoch ? captureClock : null,
        captureClockQuery,
        running: payload.running === true,
        playing: payload.playing === true,
        positionSeconds: readNumber(payload, 'positionSeconds'),
        playheadFrame: readNumber(payload, 'playheadFrame'),
        loopWraps: readNumber(payload, 'loopWraps'),
        batchesApplied: readNumber(payload, 'batchesApplied'),
        tempo: readNumber(payload, 'tempo'),
        timeSigNum: readNumber(payload, 'timeSigNum'),
        timeSigDenom: readNumber(payload, 'timeSigDenom'),
        masterPeak: readNumber(payload, 'masterPeak'),
        stripPeaks: readStripPeaks(payload),
        tunerTelemetry: readTunerTelemetry(payload),
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
