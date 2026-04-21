import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function quantizeNotes(clipId: string, gridSize: number, strength: number = 1, swing: number = 0): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => {
            const stepIndex = Math.round(node.startBeat / gridSize);
            // In a standard swing model, every second grid step is delayed.
            const isOffbeat = stepIndex % 2 !== 0;

            // Swing pushes the offbeat later. A swing of 1 would push it exactly halfway to the next grid step.
            // Adjust the multiplier if a different maximum swing depth is preferred.
            const swingOffset = isOffbeat ? swing * (gridSize / 2) : 0;
            const targetStartBeat = stepIndex * gridSize + swingOffset;

            // Apply strength (0 = no quantization, 1 = full quantization)
            const newStartBeat = node.startBeat + (targetStartBeat - node.startBeat) * strength;

            return {
                ...node,
                startBeat: newStartBeat,
            };
        })
    );
}
