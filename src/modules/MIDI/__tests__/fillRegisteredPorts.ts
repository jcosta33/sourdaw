import { setRecordingMidiAdmissionPort } from '../useCases/webMidiInput/recordingMidiAdmissionPort';

setRecordingMidiAdmissionPort({
    isRecordingMidiInputExcluded: () => false,
    admitRecordingMidiNoteOn: () => null,
    admitRecordingMidiNoteOff: () => undefined,
    admitRecordingMidiExpression: () => undefined,
    findOpenRecordingMidiAdmission: () => undefined,
    findOpenRecordingMidiMemberAdmission: () => undefined,
    getRecordingMidiAdmission: () => undefined,
    retireRecordingMidiAdmission: () => undefined,
    takeOwnsRecordingRoot: () => false,
    recordingMidiSourceBeatAt: () => null,
});
