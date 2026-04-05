import { midiStore } from '#/modules/MIDI/stores/midiStore';

/**
 * Move a pitch bend event to a new position and/or value.
 * MIDI pitch bend is 14-bit: -8192..8191 (center = 0).
 */
export function movePitchBend(clipId: string, pbId: string, newBeat: number, newValue: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.pitchBendByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: existing.map((pb) =>
                pb.id === pbId
                    ? { ...pb, beat: Math.max(0, newBeat), value: Math.max(-8192, Math.min(8191, newValue)) }
                    : pb
            ),
        },
    });
}
