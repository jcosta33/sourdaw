import { grooveStore } from '../../stores/grooveStore';

/**
 * Apply a groove template to the project or a specific clip (H4).
 * This logic computes the timing offset for a given beat based on the active groove.
 */
export function getGrooveOffsetAtBeat(beat: number): number {
    const state = grooveStore.value;
    if (!state || !state.projectGrooveId) {
        return 0;
    }

    const template = state.templates.find((t) => t.id === state.projectGrooveId);
    if (!template) {
        return 0;
    }

    const { offsets, resolution } = template;
    const step = Math.floor(beat / resolution) % offsets.length;
    const offset = offsets[step] ?? 0;

    return offset * state.projectGrooveIntensity;
}
