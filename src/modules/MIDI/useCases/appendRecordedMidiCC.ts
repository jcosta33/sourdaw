import { createMidiError } from '../errors/MidiError';
import { createMidiCC, type MidiCC } from '../models/MidiNote';
import { midiStore } from '../stores/midiStore';

type AppendRecordedMidiCCInput = {
    clipId: string;
    row: Omit<MidiCC, 'id'>;
};

function isFiniteRow({ controller, value, beat, channel }: Omit<MidiCC, 'id'>): boolean {
    return [controller, value, beat, channel].every(Number.isFinite);
}

/**
 * Append one controller message of a take. Unlike `addMidiCC`, which keeps a
 * lane's (beat, channel, controller) point unique for editing, a take keeps
 * every message in arrival order: a burst sharing one beat, such as an RPN
 * select, data entry and null-RPN sequence, must survive whole.
 */
export function appendRecordedMidiCC({ clipId, row }: AppendRecordedMidiCCInput): void {
    if (!isFiniteRow(row)) {
        throw createMidiError('Recorded controller row must carry finite numbers');
    }

    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.ccByClipId[clipId] ?? [];
    midiStore.set({
        ...midiState,
        ccByClipId: {
            ...midiState.ccByClipId,
            [clipId]: [...existing, createMidiCC(row.controller, row.value, row.beat, row.channel)],
        },
    });
}
