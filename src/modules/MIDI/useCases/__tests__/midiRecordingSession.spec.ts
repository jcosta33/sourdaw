import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    admitMidiRecordingEvent,
    advanceMidiRecordingPass,
    beginMidiRecordingSession,
    cancelMidiRecordingSession,
    sealMidiRecordingSession,
} from '../midiRecordingSession';

const state = vi.hoisted(() => ({ recording: true, armed: true, targetTrackId: 'track-1', mpe: false }));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: [{ id: 'track-1', armed: state.armed }] };
        },
    },
    takeLaneStore: { value: null },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: { baseLatency: 0, outputLatency: 0 } },
    getCompensationDelay: () => 0,
}));
vi.mock('#/modules/ControlSurface/stores', () => ({ midiLearnStore: { value: null } }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return { isRecording: state.recording };
        },
    },
    readBeatAtSamples: ({ samples }: { samples: number }) => samples * 2,
    readSecondsAtBeat: ({ beat }: { beat: number }) => beat / 2,
}));
vi.mock('../../stores/midiStore', () => ({
    midiStore: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
}));
vi.mock('../../repositories/webMidi/getMpeEnabled', () => ({ getMpeEnabled: () => state.mpe }));
vi.mock('../../repositories/webMidi/getTargetTrackId', () => ({ getTargetTrackId: () => state.targetTrackId }));

function begin(punchOutBeat?: number): void {
    beginMidiRecordingSession({
        carriers: [{ trackId: 'track-1', clipId: 'clip-1', clipStartBeat: 4 }],
        audioTime: 1,
        recordPointBeat: 4,
        ...(punchOutBeat === undefined ? {} : { punchOutBeat }),
    });
}

describe('midi recording admission ownership', () => {
    beforeEach(() => {
        cancelMidiRecordingSession();
        state.recording = true;
        state.armed = true;
        state.targetTrackId = 'track-1';
        state.mpe = false;
    });

    it('returns inactive only without a journal, then claims excluded input while one is active', () => {
        const noteOn = { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 };
        expect(admitMidiRecordingEvent({ event: noteOn, time: { audioTime: 1.25 } })).toEqual({
            disposition: 'inactive',
        });
        begin(5);
        expect(admitMidiRecordingEvent({ event: noteOn, time: { audioTime: 1.5 } })).toEqual({
            disposition: 'claimed',
        });
        state.armed = false;
        expect(admitMidiRecordingEvent({ event: noteOn, time: { audioTime: 1.25 } })).toEqual({
            disposition: 'claimed',
        });
        state.armed = true;
        expect(
            admitMidiRecordingEvent({ event: { type: 'noteOff', channel: 0, note: 60 }, time: { audioTime: 1.25 } })
        ).toEqual({ disposition: 'claimed' });
    });

    it('captures one frozen onset across a lap seam and cannot migrate a late release into a new session', () => {
        begin();
        const onset = admitMidiRecordingEvent({
            event: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            time: { audioTime: 1.25, recordingBeat: 4.5 },
        });
        expect(onset.disposition).toBe('captured');
        if (onset.disposition !== 'captured') {
            throw new Error('expected captured onset');
        }
        expect(onset.witness).toMatchObject({ sourceBeat: 0.5, timelineBeat: 4.5 });
        advanceMidiRecordingPass({ audioTime: 2, fromBeat: 6, toBeat: 0 });
        expect(
            admitMidiRecordingEvent({ event: { type: 'noteOff', channel: 0, note: 60 }, time: { audioTime: 2.25 } })
        ).toEqual(onset);
        const frozen = sealMidiRecordingSession({ audioTime: 3, timelineBeat: 2 });
        expect(frozen[0]?.midiRecording.data.notes.value).toEqual([
            expect.objectContaining({
                pitch: 60,
                recordingPassId: onset.witness.recordingPassId,
                startBeat: 0.5,
            }),
        ]);
        begin();
        expect(
            admitMidiRecordingEvent({ event: { type: 'noteOff', channel: 0, note: 60 }, time: { audioTime: 1.5 } })
        ).toEqual({ disposition: 'claimed' });
    });

    it('claims mapped or excluded controller input without writing a channel row', () => {
        begin();
        expect(
            admitMidiRecordingEvent({
                event: { type: 'cc', channel: 0, controller: 123, value: 0 },
                time: { audioTime: 1.25 },
            })
        ).toEqual({ disposition: 'claimed' });
        const frozen = sealMidiRecordingSession({ audioTime: 1.5, timelineBeat: 5 });
        expect(frozen[0]?.midiRecording.data.controlChanges.value).toEqual([]);
    });
});
