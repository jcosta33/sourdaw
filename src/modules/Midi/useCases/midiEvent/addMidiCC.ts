import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { createMidiCC, type MidiCC } from '#/modules/MIDI/models/MidiNote';

export function addMidiCC(clipId: string, controller: number, value: number, beat: number, channel = 0): MidiCC {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
    }

    const cc = createMidiCC(controller, value, beat, channel);
    const existing = state.ccByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: [...existing, cc],
        },
    });

    return cc;
}
