import { clampMidiData7 } from '#/utils/midiData';

import { midiStore } from '../../stores/midiStore';

export function moveMidiCC(clipId: string, ccId: string, newBeat: number, newValue: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.ccByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.map((context) =>
                context.id === ccId
                    ? { ...context, beat: Math.max(0, newBeat), value: clampMidiData7(newValue) }
                    : context
            ),
        },
    });
}
