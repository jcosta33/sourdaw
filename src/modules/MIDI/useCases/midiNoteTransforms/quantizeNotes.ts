import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/** One swing unit is half a beat — the eighth note "and" in 4/4. */
const SWING_UNIT_BEATS = 0.5;

export function quantizeNotes(clipId: string, gridSize: number, strength: number = 1, swing: number = 0): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => {
            const stepIndex = Math.round(node.startBeat / gridSize);
            const quantizedBeat = stepIndex * gridSize;

            // Swing delays every other half-beat ("and") position. Define the offbeat
            // relative to the beat structure (odd multiples of half a beat) rather than
            // by the parity of the raw grid-line index — otherwise the swing direction
            // flips whenever the grid resolution changes (e.g. beat 0.5 is step 1 on a
            // 1/2 grid but step 2 on a 1/4 grid, inverting `stepIndex % 2`).
            const swingUnitIndex = Math.round(quantizedBeat / SWING_UNIT_BEATS);
            const isOffbeat = swingUnitIndex % 2 !== 0;

            // Swing pushes the offbeat later. A swing of 1 pushes it exactly halfway to
            // the next grid step. Adjust the multiplier for a different maximum depth.
            const swingOffset = isOffbeat ? swing * (gridSize / 2) : 0;
            const targetStartBeat = quantizedBeat + swingOffset;

            // Apply strength (0 = no quantization, 1 = full quantization)
            const newStartBeat = node.startBeat + (targetStartBeat - node.startBeat) * strength;

            return {
                ...node,
                startBeat: newStartBeat,
            };
        })
    );
}
