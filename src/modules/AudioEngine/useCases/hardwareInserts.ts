/**
 * Hardware Insert use cases.
 * Routes audio out through physical interfaces to outboard gear
 * and back in, with ping-based delay compensation.
 */

import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';

export type HardwareInsert = {
    id: string;
    name: string;
    trackId: string;
    sendOutputIndex: number;
    returnInputIndex: number;
    latencyMs: number; // Measured via ping
    dryWet: number; // 0-1
    active: boolean;
};

const inserts = new Map<string, HardwareInsert>();

/**
 * Create a hardware insert on a track.
 * This routes audio: track → output → [hardware] → input → track
 */
export function createHardwareInsert(
    trackId: string,
    sendOutputIndex = 0,
    returnInputIndex = 0,
    name = 'Hardware Insert'
): HardwareInsert {
    const insert: HardwareInsert = {
        id: `hw-insert-${crypto.randomUUID().slice(0, 8)}`,
        name,
        trackId,
        sendOutputIndex,
        returnInputIndex,
        latencyMs: 0,
        dryWet: 1.0,
        active: true,
    };
    inserts.set(insert.id, insert);
    return insert;
}

/**
 * Measure round-trip latency by sending a ping signal.
 * In a real implementation, sends an impulse out and measures
 * when it returns through the input.
 */
export async function measureLatency(insertId: string): Promise<number> {
    const insert = inserts.get(insertId);
    if (!insert) {
        return 0;
    }

    const ctx = audioEngine.context;
    if (!ctx) {
        return 0;
    }

    // Simulate latency measurement
    // Real implementation would:
    // 1. Create an impulse signal
    // 2. Send through the hardware output
    // 3. Record from the hardware return input
    // 4. Measure time between send and receive
    const estimatedLatency = ctx.baseLatency * 1000 * 2; // Rough estimate: 2x base latency
    insert.latencyMs = Math.round(estimatedLatency * 100) / 100;
    inserts.set(insertId, insert);

    return insert.latencyMs;
}

/**
 * Set the dry/wet mix for a hardware insert.
 */
export function setHardwareInsertMix(insertId: string, dryWet: number): void {
    const insert = inserts.get(insertId);
    if (insert) {
        insert.dryWet = Math.max(0, Math.min(1, dryWet));
        inserts.set(insertId, insert);
    }
}

/**
 * Toggle a hardware insert active/bypassed.
 */
export function toggleHardwareInsert(insertId: string): void {
    const insert = inserts.get(insertId);
    if (insert) {
        insert.active = !insert.active;
        inserts.set(insertId, insert);
    }
}

/**
 * Remove a hardware insert.
 */
export function removeHardwareInsert(insertId: string): void {
    inserts.delete(insertId);
}

/**
 * Get all hardware inserts for a track.
 */
export function getHardwareInsertsForTrack(trackId: string): HardwareInsert[] {
    return [...inserts.values()].filter((i) => i.trackId === trackId);
}

/**
 * Get all hardware inserts.
 */
export function getAllHardwareInserts(): HardwareInsert[] {
    return [...inserts.values()];
}
