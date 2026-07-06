import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidi } from '../../../models/ProjectData';

import {
    mapProjectMidiValues,
    type RuntimeCC,
    type RuntimePitchBend,
    type SerializedCC,
    type SerializedPitchBend,
} from './midiStateMapping';
import { serializeProjectMidiNote } from './serializeProjectMidiNote';

function serializeProjectMidiCC(cc: RuntimeCC): SerializedCC {
    return { beat: cc.beat, controller: cc.controller, value: cc.value, channel: cc.channel };
}

function serializeProjectMidiPitchBend(pb: RuntimePitchBend): SerializedPitchBend {
    return { beat: pb.beat, value: pb.value, channel: pb.channel };
}

/** Serialize the runtime MIDI store into the `.sourdaw` MIDI block. */
export function serializeProjectMidi(midi: MidiStoreState): ProjectMidi {
    return {
        notesByClipId: mapProjectMidiValues({
            byClipId: midi.notesByClipId,
            mapEntry: serializeProjectMidiNote,
        }),
        ccByClipId: mapProjectMidiValues({
            byClipId: midi.ccByClipId,
            mapEntry: serializeProjectMidiCC,
        }),
        pitchBendByClipId: mapProjectMidiValues({
            byClipId: midi.pitchBendByClipId,
            mapEntry: serializeProjectMidiPitchBend,
        }),
    };
}
