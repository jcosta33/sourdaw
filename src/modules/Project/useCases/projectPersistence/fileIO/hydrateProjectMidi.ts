import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidi } from '../../../models/ProjectData';

import {
    mapProjectMidiValues,
    type RuntimeCC,
    type RuntimeNote,
    type RuntimePitchBend,
    type SerializedCC,
    type SerializedNote,
    type SerializedPitchBend,
} from './midiStateMapping';

function hydrateProjectMidiNote(note: SerializedNote): RuntimeNote {
    return note;
}

type HydrateProjectMidiCCInput = {
    cc: SerializedCC;
    clipId: string;
    index: number;
};

type HydrateProjectMidiCCOutput = RuntimeCC;

function hydrateProjectMidiCC({ cc, clipId, index }: HydrateProjectMidiCCInput): HydrateProjectMidiCCOutput {
    return {
        id: `cc-${clipId}-${index}`,
        controller: cc.controller,
        value: cc.value,
        beat: cc.beat,
        channel: cc.channel,
    };
}

type HydrateProjectMidiPitchBendInput = {
    pb: SerializedPitchBend;
    clipId: string;
    index: number;
};

type HydrateProjectMidiPitchBendOutput = RuntimePitchBend;

function hydrateProjectMidiPitchBend({
    pb,
    clipId,
    index,
}: HydrateProjectMidiPitchBendInput): HydrateProjectMidiPitchBendOutput {
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
        notesByClipId: mapProjectMidiValues({
            byClipId: midi.notesByClipId,
            mapEntry: hydrateProjectMidiNote,
        }),
        ccByClipId: mapProjectMidiValues({
            byClipId: midi.ccByClipId,
            mapEntry: (cc, index, clipId) => hydrateProjectMidiCC({ cc, clipId, index }),
        }),
        pitchBendByClipId: mapProjectMidiValues({
            byClipId: midi.pitchBendByClipId,
            mapEntry: (pb, index, clipId) => hydrateProjectMidiPitchBend({ pb, clipId, index }),
        }),
    };
}
