import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortModule = typeof import('../recordingMidiAdmissionPort');
type Port = Parameters<PortModule['setRecordingMidiAdmissionPort']>[0];

const position = { beat: 1, passIndex: 0 };

function createPort(overrides: Partial<Port> = {}): Port {
    return {
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
        ...overrides,
    };
}

describe('recordingMidiAdmissionPort', () => {
    let port: PortModule['recordingMidiAdmissionPort'];
    let setPort: PortModule['setRecordingMidiAdmissionPort'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled port; the shared spec fixture only fills the first one.
        vi.resetModules();
        const module = await import('../recordingMidiAdmissionPort');
        port = module.recordingMidiAdmissionPort;
        setPort = module.setRecordingMidiAdmissionPort;
    });

    it.each([
        ['isRecordingMidiInputExcluded', () => port.isRecordingMidiInputExcluded(0)],
        [
            'admitRecordingMidiNoteOn',
            () =>
                port.admitRecordingMidiNoteOn({
                    trackId: 't',
                    channel: 0,
                    note: 60,
                    velocity: 1,
                    audioTime: 0,
                    position,
                }),
        ],
        [
            'admitRecordingMidiNoteOff',
            () => port.admitRecordingMidiNoteOff({ channel: 0, note: 60, audioTime: 0, position }),
        ],
        [
            'admitRecordingMidiExpression',
            () =>
                port.admitRecordingMidiExpression({
                    channel: 0,
                    dimension: 'pressure',
                    value: 0,
                    audioTime: 0,
                    position,
                }),
        ],
        ['findOpenRecordingMidiAdmission', () => port.findOpenRecordingMidiAdmission(0, 60)],
        ['findOpenRecordingMidiMemberAdmission', () => port.findOpenRecordingMidiMemberAdmission(0)],
        ['getRecordingMidiAdmission', () => port.getRecordingMidiAdmission('id')],
        ['retireRecordingMidiAdmission', () => port.retireRecordingMidiAdmission('id')],
        ['takeOwnsRecordingRoot', () => port.takeOwnsRecordingRoot()],
        ['recordingMidiSourceBeatAt', () => port.recordingMidiSourceBeatAt('clip', position)],
    ])('%s throws naming the port, the fill and its registrar while none is registered', (name, read) => {
        expect(read).toThrow(`recordingMidiAdmissionPort.${name}: no admission port is registered`);
        expect(read).toThrow(
            'setRecordingMidiAdmissionPort() from wireMidiAndNotificationBuses() in src/app/bootstrap.ts'
        );
    });

    it('answers through the filled port', () => {
        const isRecordingMidiInputExcluded = vi.fn(() => true);
        setPort(createPort({ isRecordingMidiInputExcluded, recordingMidiSourceBeatAt: () => 3.5 }));

        expect(port.isRecordingMidiInputExcluded(2, 'track', 'clip')).toBe(true);
        expect(isRecordingMidiInputExcluded).toHaveBeenCalledWith(2, 'track', 'clip');
        expect(port.recordingMidiSourceBeatAt('clip', position)).toBe(3.5);
    });

    it('a second fill replaces the first', () => {
        const first = vi.fn(() => true);
        const second = vi.fn(() => false);
        setPort(createPort({ takeOwnsRecordingRoot: first }));
        setPort(createPort({ takeOwnsRecordingRoot: second }));

        expect(port.takeOwnsRecordingRoot()).toBe(false);
        expect(first).not.toHaveBeenCalled();
    });
});
