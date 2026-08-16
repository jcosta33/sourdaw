/**
 * Rolling momentary-loudness history, one ring buffer per Proof device.
 *
 * Kept outside the graph component because the panel renders exactly one desk
 * level at a time: the component that draws the history unmounts on every
 * Build <-> Lab switch. A component-local buffer would restart the 30-second
 * window each time, so the history a user leaves to check the tonal balance is
 * gone when they come back. Keyed by device so two open Proof instances keep
 * their own history, and dropped when the device is unregistered.
 */
import { createCompactFloatBuffer } from '#/utils/createCompactFloatBuffer';

/** Samples retained per device: 300 slots at one sample per 100 ms is 30 seconds. */
export const PROOF_LOUDNESS_HISTORY_LENGTH = 300;

/**
 * Sampling period of the history. Fixed rather than "once per render": the
 * meter poll pushes ~62 frames a second, so sampling per frame held under five
 * seconds in the same 300 slots, and a re-render caused by a resize or a target
 * change injected a duplicate sample that bent the time axis.
 */
export const PROOF_LOUDNESS_SAMPLE_INTERVAL_MS = 100;

type ProofLoudnessHistoryEntry = {
    samples: Float32Array;
    /** Total samples ever written; the write cursor is this modulo the length. */
    written: number;
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
    };
    histories.set(deviceId, created);
    return created;
}

export function pushProofLoudnessSample(deviceId: string, lufs: number): void {
    const entry = getEntry(deviceId);
    entry.samples[entry.written % PROOF_LOUDNESS_HISTORY_LENGTH] = lufs;
    entry.written++;
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

/** Drop a device's history. Called when the device itself goes away. */
export function clearProofLoudnessHistory(deviceId: string): void {
    histories.delete(deviceId);
}
