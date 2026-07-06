import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidiCC, type ProjectMidiNote, type ProjectMidiPitchBend } from '../../../models/ProjectData';

export type RuntimeNote = MidiStoreState['notesByClipId'][string][number];
export type RuntimeCC = MidiStoreState['ccByClipId'][string][number];
export type RuntimePitchBend = MidiStoreState['pitchBendByClipId'][string][number];

export type SerializedNote = ProjectMidiNote;
export type SerializedCC = ProjectMidiCC;
export type SerializedPitchBend = ProjectMidiPitchBend;

type MapProjectMidiValuesInput<InputEntry, OutputEntry> = {
    byClipId: Record<string, InputEntry[]> | undefined;
    mapEntry: (entry: InputEntry, index: number, clipId: string) => OutputEntry;
};

type MapProjectMidiValuesOutput<OutputEntry> = Record<string, OutputEntry[]>;

export function mapProjectMidiValues<InputEntry, OutputEntry>({
    byClipId,
    mapEntry,
}: MapProjectMidiValuesInput<InputEntry, OutputEntry>): MapProjectMidiValuesOutput<OutputEntry> {
    const out: MapProjectMidiValuesOutput<OutputEntry> = {};
    for (const [clipId, entries] of Object.entries(byClipId ?? {})) {
        out[clipId] = entries.map((entry, index) => mapEntry(entry, index, clipId));
    }
    return out;
}
