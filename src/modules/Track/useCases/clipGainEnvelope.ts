/**
 * Clip gain envelope use cases.
 * Node-based automation embedded within clips that moves when clips move.
 * Pro Tools-style clip gain: editable breakpoints controlling clip-level volume.
 *
 * Envelope points are relative to clip start (beat offset 0 = clip start).
 */



export type GainEnvelopePoint = {
    id: string;
    beatOffset: number; // relative to clip start
    gainDb: number; // -inf to +12 dB
};

export type ClipGainEnvelope = {
    clipId: string;
    points: GainEnvelopePoint[];
    enabled: boolean;
};

// In-memory store for clip gain envelopes (keyed by clipId)
const envelopes = new Map<string, ClipGainEnvelope>();

/**
 * Get or create a gain envelope for a clip.
 */
export function getClipGainEnvelope(clipId: string): ClipGainEnvelope {
    let envelope = envelopes.get(clipId);
    if (!envelope) {
        envelope = {
            clipId,
            points: [
                { id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 },
            ],
            enabled: true,
        };
        envelopes.set(clipId, envelope);
    }
    return envelope;
}

/**
 * Toggle envelope enabled/disabled.
 */
export function toggleClipGainEnvelope(clipId: string): boolean {
    const env = getClipGainEnvelope(clipId);
    env.enabled = !env.enabled;
    envelopes.set(clipId, env);
    return env.enabled;
}

/**
 * Add a breakpoint to a clip gain envelope.
 */
export function addGainEnvelopePoint(clipId: string, beatOffset: number, gainDb: number): GainEnvelopePoint {
    const env = getClipGainEnvelope(clipId);
    const point: GainEnvelopePoint = {
        id: `gep-${crypto.randomUUID().slice(0, 6)}`,
        beatOffset: Math.max(0, beatOffset),
        gainDb: Math.max(-60, Math.min(12, gainDb)),
    };

    // Insert in sorted order
    const idx = env.points.findIndex((p) => p.beatOffset > beatOffset);
    if (idx === -1) {
        env.points.push(point);
    } else {
        env.points.splice(idx, 0, point);
    }

    envelopes.set(clipId, env);
    return point;
}

/**
 * Remove a breakpoint from a clip gain envelope.
 */
export function removeGainEnvelopePoint(clipId: string, pointId: string): void {
    const env = envelopes.get(clipId);
    if (!env) {
        return;
    }
    env.points = env.points.filter((p) => p.id !== pointId);
    // Always keep at least one point
    if (env.points.length === 0) {
        env.points.push({ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 });
    }
    envelopes.set(clipId, env);
}

/**
 * Move a breakpoint (change offset and/or gain).
 */
export function moveGainEnvelopePoint(clipId: string, pointId: string, beatOffset: number, gainDb: number): void {
    const env = envelopes.get(clipId);
    if (!env) {
        return;
    }
    const point = env.points.find((p) => p.id === pointId);
    if (!point) {
        return;
    }
    point.beatOffset = Math.max(0, beatOffset);
    point.gainDb = Math.max(-60, Math.min(12, gainDb));
    // Re-sort
    env.points.sort((a, b) => a.beatOffset - b.beatOffset);
    envelopes.set(clipId, env);
}

/**
 * Get the interpolated gain value at a specific beat offset within a clip.
 * Uses linear interpolation between breakpoints.
 *
 * @returns gain in dB
 */
export function getGainAtBeat(clipId: string, beatOffset: number): number {
    const env = envelopes.get(clipId);
    if (!env || !env.enabled || env.points.length === 0) {
        return 0;
    }

    const points = env.points;

    // Before first point
    if (beatOffset <= points[0]!.beatOffset) {
        return points[0]!.gainDb;
    }

    // After last point
    if (beatOffset >= points[points.length - 1]!.beatOffset) {
        return points[points.length - 1]!.gainDb;
    }

    // Linear interpolation between surrounding points
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        if (beatOffset >= a.beatOffset && beatOffset <= b.beatOffset) {
            const t = (beatOffset - a.beatOffset) / (b.beatOffset - a.beatOffset);
            return a.gainDb + t * (b.gainDb - a.gainDb);
        }
    }

    return 0;
}

/**
 * Shift all envelope points when a clip moves.
 * (Points are relative to clip start, so no shift needed — but this is here
 * for future absolute-coordinate systems.)
 */
export function getAllClipGainEnvelopes(): Map<string, ClipGainEnvelope> {
    return envelopes;
}

/**
 * Clear an envelope (reset to flat 0dB).
 */
export function resetClipGainEnvelope(clipId: string): void {
    envelopes.set(clipId, {
        clipId,
        points: [{ id: `gep-${crypto.randomUUID().slice(0, 6)}`, beatOffset: 0, gainDb: 0 }],
        enabled: true,
    });
}
