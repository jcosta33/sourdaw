import { createMidiError } from '../../errors/MidiError';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function addMidiCC(clipId: string, controller: number, value: number, beat: number, channel = 0): MidiCC {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
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
