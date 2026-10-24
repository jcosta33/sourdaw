import { createMidiError } from '../../errors/MidiError';
import { type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Put a removed pitch-bend point back exactly as it was: its id, value, beat and channel, and the
 * `channelScoped` mark of a recorded row, which `addPitchBend` cannot carry.
 */
export function restorePitchBend(clipId: string, row: MidiPitchBend): void {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    const existing = state.pitchBendByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: [...existing, row],
        },
    });
}
