/**
 * Rolling momentary-loudness history, one ring buffer per Proof device.
 *
 * Sampled here, on a clock owned by the device, rather than by the component
 * that draws it. The panel renders exactly one desk level at a time, so the
 * history graph unmounts on every Build <-> Lab switch and again when the panel
 * closes; a clock that stopped with it would leave the buffer holding samples
 * from before the excursion next to samples from after it, at the same pitch,
 * with the elapsed minutes spliced out. The graph is read as a continuous
 * 30-second window against the target line, so the time axis has to be real
 * duration: the device samples for as long as it is registered, and a graph
 * that comes back shows the gap it was away for. Keyed by device so two open
 * Proof instances keep their own history, and dropped when the device is
 * unregistered.
 */
import { createCompactFloatBuffer } from '#/utils/createCompactFloatBuffer';

import { getProofState } from './proofStore';

/** Samples retained per device: 300 slots at one sample per 100 ms is 30 seconds. */
export const PROOF_LOUDNESS_HISTORY_LENGTH = 300;

/**
 * Sampling period of the history. Fixed rather than "once per meter frame": the
 * engine pushes ~62 frames a second, so sampling per frame filled the same 300
 * slots in under five seconds, and a frame arriving off-cadence bent the time
 * axis.
 */
export const PROOF_LOUDNESS_SAMPLE_INTERVAL_MS = 100;

type ProofLoudnessHistoryEntry = {
    samples: Float32Array;
    /** Total samples ever written; the write cursor is this modulo the length. */
    written: number;
    /** The device's sampling clock, running for as long as the device is registered. */
    timer: ReturnType<typeof setInterval> | undefined;
};

const histories = new Map<string, ProofLoudnessHistoryEntry>();

function getEntry(deviceId: string): ProofLoudnessHistoryEntry {
    const existing = histories.get(deviceId);
    if (existing) {
        return existing;
    }

    const created: ProofLoudnessHistoryEntry = {
        samples: createCompactFloatBuffer({ length: PROOF_LOUDNESS_HISTORY_LENGTH }),
        written: 0,
        timer: undefined,
    };
    histories.set(deviceId, created);
    return created;
}

function pushProofLoudnessSample(deviceId: string, lufs: number): void {
    const entry = getEntry(deviceId);
    entry.samples[entry.written % PROOF_LOUDNESS_HISTORY_LENGTH] = lufs;
    entry.written++;
}

/**
 * Start the device's sampling clock. Idempotent: a re-registration replaces the
 * audio bridge, and restarting the clock there would reset the phase of a window
 * the user is already reading.
 */
export function startProofLoudnessSampler(deviceId: string): void {
    const entry = getEntry(deviceId);
    if (entry.timer !== undefined) {
        return;
    }

    entry.timer = setInterval(() => {
        // Read on our own clock rather than riding the meter path: the meter
        // sink drops frames that repeat the previous numbers, and a held level
        // is still elapsed time that the graph has to show.
        pushProofLoudnessSample(deviceId, getProofState(deviceId).outputLufs);
    }, PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
}

/** Stop the device's sampling clock. Safe to call for an unknown device. */
export function stopProofLoudnessSampler(deviceId: string): void {
    const entry = histories.get(deviceId);
    if (entry?.timer === undefined) {
        return;
    }
    clearInterval(entry.timer);
    entry.timer = undefined;
}

/** The retained samples, oldest first. A fresh array, so it is safe to hold. */
export function readProofLoudnessHistory(deviceId: string): number[] {
    const entry = getEntry(deviceId);
    const length = Math.min(entry.written, PROOF_LOUDNESS_HISTORY_LENGTH);
    const oldest = entry.written - length;
    const samples: number[] = Array.from({ length });
    for (let index = 0; index < length; index++) {
        samples[index] = entry.samples[(oldest + index) % PROOF_LOUDNESS_HISTORY_LENGTH] ?? 0;
    }
    return samples;
}

/**
 * Drop a device's history and stop its clock. Called when the device itself goes
 * away; the clock outlives every graph, so this is the only thing that ends it.
 */
export function clearProofLoudnessHistory(deviceId: string): void {
    stopProofLoudnessSampler(deviceId);
    histories.delete(deviceId);
}
