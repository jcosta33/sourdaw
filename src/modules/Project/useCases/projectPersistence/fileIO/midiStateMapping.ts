import { type MidiStoreState } from '#/modules/MIDI/stores';

import {
    type ProjectMidi,
    type ProjectMidiCC,
    type ProjectMidiNote,
    type ProjectMidiPitchBend,
} from '../../../models/ProjectData';

type RuntimeNote = MidiStoreState['notesByClipId'][string][number];
type RuntimeCC = MidiStoreState['ccByClipId'][string][number];
type RuntimePitchBend = MidiStoreState['pitchBendByClipId'][string][number];

function mapValues<In, Out>(
    byClipId: Record<string, In[]> | undefined,
    map: (entry: In, index: number) => Out
): Record<string, Out[]> {
    const out: Record<string, Out[]> = {};
    for (const [clipId, entries] of Object.entries(byClipId ?? {})) {
        out[clipId] = entries.map((entry, index) => map(entry, index));
    }
    return out;
}

export function serializeProjectMidiNote(note: RuntimeNote): ProjectMidiNote {
    return {
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
        probability: note.probability ?? 100,
        pressure: note.pressure ?? 0,
        slide: note.slide ?? 0,
        pitchBend: note.pitchBend ?? 0,
    };
}

function serializeCC(cc: RuntimeCC): ProjectMidiCC {
    return { beat: cc.beat, controller: cc.controller, value: cc.value, channel: cc.channel };
}

function serializePitchBend(pb: RuntimePitchBend): ProjectMidiPitchBend {
    return { beat: pb.beat, value: pb.value, channel: pb.channel };
}

/** Serialize the runtime MIDI store into the `.sourdaw` MIDI block. */
export function serializeProjectMidi(midi: MidiStoreState): ProjectMidi {
    return {
        notesByClipId: mapValues(midi.notesByClipId, serializeProjectMidiNote),
        ccByClipId: mapValues(midi.ccByClipId, serializeCC),
        pitchBendByClipId: mapValues(midi.pitchBendByClipId, serializePitchBend),
    };
}

function hydrateNote(note: ProjectMidiNote): RuntimeNote {
    return note;
}

function hydrateCC(cc: ProjectMidiCC, clipId: string, index: number): RuntimeCC {
    return {
        id: `cc-${clipId}-${index}`,
        controller: cc.controller,
        value: cc.value,
        beat: cc.beat,
        channel: cc.channel,
    };
}

function hydratePitchBend(pb: ProjectMidiPitchBend, clipId: string, index: number): RuntimePitchBend {
    return {
        id: `pb-${clipId}-${index}`,
        value: pb.value,
        beat: pb.beat,
        channel: pb.channel,
    };
}

/** Hydrate the runtime MIDI store from the serialized `.sourdaw` MIDI block.
 *  Notes already carry ids; CC and pitch-bend get a deterministic id minted from
 *  the clip id and index, since the serialized schema omits the runtime `id`. */
export function hydrateProjectMidi(midi: ProjectMidi): MidiStoreState {
    return {
        notesByClipId: mapValues(midi.notesByClipId, hydrateNote),
        ccByClipId: Object.fromEntries(
            Object.entries(midi.ccByClipId ?? {}).map(([clipId, entries]) => [
                clipId,
                entries.map((cc, index) => hydrateCC(cc, clipId, index)),
            ])
        ),
        pitchBendByClipId: Object.fromEntries(
            Object.entries(midi.pitchBendByClipId ?? {}).map(([clipId, entries]) => [
                clipId,
                entries.map((pb, index) => hydratePitchBend(pb, clipId, index)),
            ])
        ),
    };
}
