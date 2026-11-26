import type { RecordingMidiAdmission } from '#/modules/Arrangement/stores';

type EventPosition = { beat: number; passIndex: number };

export type RecordingMidiAdmissionPort = {
    isRecordingMidiInputExcluded(audioTime: number, trackId?: string | null, clipId?: string): boolean;
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
    recordingMidiSourceBeatAt(clipId: string, position: EventPosition): number | null;
};

let configured: RecordingMidiAdmissionPort | null = null;

function readConfigured(caller: string): RecordingMidiAdmissionPort {
    if (configured === null) {
        throw new Error(
            `recordingMidiAdmissionPort.${caller}: no admission port is registered; call setRecordingMidiAdmissionPort() from wireMidiAndNotificationBuses() in src/app/bootstrap.ts`
        );
    }
    return configured;
}

/** Registered synchronously by app bootstrap before live input starts; reading it earlier throws. */
export const recordingMidiAdmissionPort: RecordingMidiAdmissionPort = {
    isRecordingMidiInputExcluded: (audioTime, trackId, clipId) =>
        readConfigured('isRecordingMidiInputExcluded').isRecordingMidiInputExcluded(audioTime, trackId, clipId),
    admitRecordingMidiNoteOn: (input) => readConfigured('admitRecordingMidiNoteOn').admitRecordingMidiNoteOn(input),
    admitRecordingMidiNoteOff: (input) => readConfigured('admitRecordingMidiNoteOff').admitRecordingMidiNoteOff(input),
    admitRecordingMidiExpression: (input) =>
        readConfigured('admitRecordingMidiExpression').admitRecordingMidiExpression(input),
    findOpenRecordingMidiAdmission: (channel, note) =>
        readConfigured('findOpenRecordingMidiAdmission').findOpenRecordingMidiAdmission(channel, note),
    findOpenRecordingMidiMemberAdmission: (channel) =>
        readConfigured('findOpenRecordingMidiMemberAdmission').findOpenRecordingMidiMemberAdmission(channel),
    getRecordingMidiAdmission: (id) => readConfigured('getRecordingMidiAdmission').getRecordingMidiAdmission(id),
    retireRecordingMidiAdmission: (id) =>
        readConfigured('retireRecordingMidiAdmission').retireRecordingMidiAdmission(id),
    takeOwnsRecordingRoot: () => readConfigured('takeOwnsRecordingRoot').takeOwnsRecordingRoot(),
    recordingMidiSourceBeatAt: (clipId, position) =>
        readConfigured('recordingMidiSourceBeatAt').recordingMidiSourceBeatAt(clipId, position),
};

export function setRecordingMidiAdmissionPort(port: RecordingMidiAdmissionPort): void {
    configured = port;
}
