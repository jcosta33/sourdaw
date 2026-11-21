import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';

import { type Track } from '../../stores/trackStore';

export type FreezeMidiSnapshot = {
    notes: MidiStoreState['notesByClipId'];
    cc: MidiStoreState['ccByClipId'];
    pitchBend: MidiStoreState['pitchBendByClipId'];
};

type RowsByClipId<Row> = Record<string, Row[]>;

function midiClipIds(clips: Track['clips']): string[] {
    return clips.filter((clip) => clip.type === 'midi').map((clip) => clip.id);
}

function copyRows<Row>(clipIds: string[], rowsByClipId: RowsByClipId<Row> | undefined): RowsByClipId<Row> {
    const copy: RowsByClipId<Row> = {};
    for (const clipId of clipIds) {
        copy[clipId] = structuredClone(rowsByClipId?.[clipId] ?? []);
    }
    return copy;
}

/** The notes and controller rows a freeze render reads, copied at the moment the freeze starts. */
export function captureFreezeMidi(clips: Track['clips']): FreezeMidiSnapshot {
    const clipIds = midiClipIds(clips);
    return {
        notes: copyRows(clipIds, midiStore.value?.notesByClipId),
        cc: copyRows(clipIds, midiStore.value?.ccByClipId),
        pitchBend: copyRows(clipIds, midiStore.value?.pitchBendByClipId),
    };
}
