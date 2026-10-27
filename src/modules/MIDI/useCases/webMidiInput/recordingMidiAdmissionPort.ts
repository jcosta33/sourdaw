import type { RecordingMidiAdmission } from '#/modules/Arrangement/stores';

type EventPosition = { beat: number; passIndex: number };

export type RecordingMidiAdmissionPort = {
    admitRecordingMidiNoteOn(input: {
        trackId: string;
        channel: number;
        note: number;
        velocity: number;
        audioTime: number;
        position: EventPosition;
        initialExpression?: RecordingMidiAdmission['initialExpression'];
    }): RecordingMidiAdmission | null;
    admitRecordingMidiNoteOff(input: {
        channel: number;
        note: number;
        audioTime: number;
        position: EventPosition;
    }): void;
    admitRecordingMidiExpression(input: {
        channel: number;
        dimension: 'pressure' | 'slide' | 'pitchBend';
        value: number;
        audioTime: number;
        bendRangeSemitones?: number;
        position: EventPosition;
    }): void;
    findOpenRecordingMidiAdmission(channel: number, note: number): RecordingMidiAdmission | undefined;
    findOpenRecordingMidiMemberAdmission(channel: number): RecordingMidiAdmission | undefined;
    getRecordingMidiAdmission(id: string): RecordingMidiAdmission | undefined;
    retireRecordingMidiAdmission(id: string): void;
    takeOwnsRecordingRoot(): boolean;
};

const inactive: RecordingMidiAdmissionPort = {
    admitRecordingMidiNoteOn: () => null,
    admitRecordingMidiNoteOff: () => undefined,
    admitRecordingMidiExpression: () => undefined,
    findOpenRecordingMidiAdmission: () => undefined,
    findOpenRecordingMidiMemberAdmission: () => undefined,
    getRecordingMidiAdmission: () => undefined,
    retireRecordingMidiAdmission: () => undefined,
    takeOwnsRecordingRoot: () => false,
};

let configured = inactive;

/** Registered synchronously by app bootstrap before live input starts. */
export const recordingMidiAdmissionPort: RecordingMidiAdmissionPort = {
    admitRecordingMidiNoteOn: (input) => configured.admitRecordingMidiNoteOn(input),
    admitRecordingMidiNoteOff: (input) => configured.admitRecordingMidiNoteOff(input),
    admitRecordingMidiExpression: (input) => configured.admitRecordingMidiExpression(input),
    findOpenRecordingMidiAdmission: (channel, note) => configured.findOpenRecordingMidiAdmission(channel, note),
    findOpenRecordingMidiMemberAdmission: (channel) => configured.findOpenRecordingMidiMemberAdmission(channel),
    getRecordingMidiAdmission: (id) => configured.getRecordingMidiAdmission(id),
    retireRecordingMidiAdmission: (id) => configured.retireRecordingMidiAdmission(id),
    takeOwnsRecordingRoot: () => configured.takeOwnsRecordingRoot(),
};

export function setRecordingMidiAdmissionPort(port: RecordingMidiAdmissionPort): () => void {
    configured = port;
    return () => {
        if (configured === port) {
            configured = inactive;
        }
    };
}
