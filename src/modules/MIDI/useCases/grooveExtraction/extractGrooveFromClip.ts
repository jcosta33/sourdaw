import { midiStore } from '../../stores/midiStore';
import type { GrooveTemplate } from './helpers';

/**
 * Extract a groove template from a MIDI clip.
 * Analyzes note start positions relative to the nearest grid division
 * and captures the timing deviation pattern.
 *
 * @param clipId - Source MIDI clip to extract groove from
 * @param gridDivision - Grid resolution for analysis (default: 0.25 = 16th notes)
 * @returns A GrooveTemplate that can be applied to other clips
 */
export function extractGrooveFromClip(clipId: string, gridDivision = 0.25): GrooveTemplate | null {
    const notesByClip = midiStore.value?.notesByClipId;
    if (!notesByClip) {
        return null;
    }

    const notes = notesByClip[clipId];
    if (!notes || notes.length === 0) {
        return null;
    }

    // Find clip bounds
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    for (const n of notes) {
        if (n.startBeat < minBeat) { minBeat = n.startBeat; }
        const end = n.startBeat + n.duration;
        if (end > maxBeat) { maxBeat = end; }
    }
    const clipLength = maxBeat - minBeat;

    // Number of grid positions in the clip
    const gridCount = Math.ceil(clipLength / gridDivision);

    // For each grid position, find notes near it and compute average offset
    const offsets: GrooveTemplate['offsets'] = [];

    for (let i = 0; i < gridCount; i++) {
        const gridBeat = minBeat + i * gridDivision;

        // Find notes within half a grid division of this position
        const nearbyNotes = notes.filter((n) => {
            const distance = Math.abs(n.startBeat - gridBeat);
            return distance < gridDivision * 0.5;
        });

        if (nearbyNotes.length === 0) {
            continue;
        }

        // Average timing offset
        const avgOffset = nearbyNotes.reduce((sum, n) => sum + (n.startBeat - gridBeat), 0) / nearbyNotes.length;

        // Average velocity relative to 100 (default)
        const avgVelocity = nearbyNotes.reduce((sum, n) => sum + n.velocity, 0) / nearbyNotes.length;
        const velocityScale = Math.max(0.5, Math.min(1.5, avgVelocity / 100));

        offsets.push({
            gridPosition: i % Math.round(1 / gridDivision), // Wrap to one beat
            timingOffset: avgOffset,
            velocityScale,
        });
    }

    return {
        id: `groove-${crypto.randomUUID().slice(0, 8)}`,
        name: `Groove from clip`,
        offsets,
        gridDivision,
        sourceClipId: clipId,
    };
}