import { type MidiStoreState } from '#/modules/MIDI/stores';

import { type ProjectMidi, type ProjectMidiCC, type ProjectMidiPitchBend } from '../../../models/ProjectData';

import { mapProjectMidiValues } from './midiStateMapping';
import { serializeProjectMidiNote } from './serializeProjectMidiNote';

type RuntimeCC = MidiStoreState['ccByClipId'][string][number];
type RuntimePitchBend = MidiStoreState['pitchBendByClipId'][string][number];

function serializeProjectMidiCC(cc: RuntimeCC): ProjectMidiCC {
    return { beat: cc.beat, controller: cc.controller, value: cc.value, channel: cc.channel };
}

function serializeProjectMidiPitchBend(pb: RuntimePitchBend): ProjectMidiPitchBend {
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
