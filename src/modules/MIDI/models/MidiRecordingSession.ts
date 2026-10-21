import { type AppAction } from '#/utils/handlerContract';

import { type MidiExpressionDimension } from './MidiNote';

export type MidiRecordingWitness = Readonly<{
    sessionId: string;
    noteId?: string;
    recordingPassId: string;
    trackId: string;
    clipId: string;
    timelineBeat: number;
    sourceBeat: number;
    audioTime: number;
}>;

export type MidiRecordingEvent =
    | { type: 'noteOn'; channel: number; note: number; velocity: number }
    | { type: 'noteOff'; channel: number; note: number }
    | { type: 'expression'; channel: number; dimension: MidiExpressionDimension; value: number; bendRangeSemitones?: number }
    | { type: 'cc'; channel: number; controller: number; value: number }
    | { type: 'pitchBend'; channel: number; value: number };

export type FrozenMidiRecording = NonNullable<Extract<AppAction, { type: 'commitRecording' }>['payload']['midiRecording']>;

export type MidiRecordingSessionApi = {
    beginMidiRecordingSession: (input: {
        carriers: readonly { trackId: string; clipId: string; clipStartBeat: number; midiOffsetBeats?: number }[];
        audioTime: number;
        recordPointBeat: number;
    }) => void;
    advanceMidiRecordingPass: (input: { audioTime: number; fromBeat: number; toBeat: number }) => void;
    admitMidiRecordingEvent: (input: {
        event: MidiRecordingEvent;
        time: Readonly<{ audioTime: number; recordingBeat?: number }>;
    }) => MidiRecordingWitness | undefined;
    sealMidiRecordingSession: (input: { audioTime: number; timelineBeat: number }) => readonly {
        clipId: string;
        midiRecording: FrozenMidiRecording;
    }[];
    cancelMidiRecordingSession: () => void;
};
