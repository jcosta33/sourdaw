import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { activeRecordingRef } from '../../../stores/activeRecordingRef';
import { trackStore } from '../../../stores/trackStore';
import { admitRecordingMidiExpression } from '../admitRecordingMidiExpression';
import { admitRecordingMidiNoteOff } from '../admitRecordingMidiNoteOff';
import { admitRecordingMidiNoteOn } from '../admitRecordingMidiNoteOn';
import { recordingMidiBound } from '../recordingMidiBound';
import { recordingMidiSourceBeatAt } from '../recordingMidiSourceBeatAt';

describe('recording MIDI media origin', () => {
    beforeEach(() => {
        recordingMidiBound.clear();
        activeRecordingRef.current = ['capture'];
        activeRecordingRef.capturedRootIdentity = null;
        activeRecordingRef.startWrapCount = 0;
        activeRecordingRef.startBeat = 10;
        activeRecordingRef.startedLooping = true;
        activeRecordingRef.passOrigins = new Map([[1, { beat: 8, unwrappedBeat: 12 }]]);
        activeRecordingRef.midiAdmissions = [];
        transportStore.set({ ...defaultTransportState, isRecording: true, isPlaying: true });
    });

    afterEach(() => {
        activeRecordingRef.current = [];
        activeRecordingRef.midiAdmissions = [];
        activeRecordingRef.passOrigins = new Map();
        recordingMidiBound.clear();
    });

    function seed(offset: number): void {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track',
                    kind: 'midi',
                    armed: true,
                    clips: [
                        {
                            id: 'capture',
                            trackId: 'track',
                            name: 'Recording',
                            type: 'midi',
                            startBeat: 10,
                            endBeat: 10,
                            midiOffsetBeats: offset,
                            gain: 1,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: 'track',
            ghostClips: [],
        });
    }

    it('keeps a compensated downbeat before clamping and preserves fixed pass origins', () => {
        seed(0.06);
        expect(recordingMidiSourceBeatAt('capture', { beat: 9.94, passIndex: 0 })).toBeCloseTo(0, 10);
        expect(recordingMidiSourceBeatAt('capture', { beat: 10, passIndex: 0 })).toBeCloseTo(0.06, 10);
        expect(recordingMidiSourceBeatAt('capture', { beat: 8.5, passIndex: 1 })).toBeCloseTo(2.56, 10);
        transportStore.set({ ...transportStore.value!, loopStart: 3, loopEnd: 30 });
        expect(recordingMidiSourceBeatAt('capture', { beat: 8.5, passIndex: 1 })).toBeCloseTo(2.56, 10);
    });

    it.each([0, 0.06])('uses the same origin for ordinary onset, expression and release with offset %s', (offset) => {
        seed(offset);
        const admitted = admitRecordingMidiNoteOn({
            trackId: 'track',
            channel: 1,
            note: 60,
            velocity: 100,
            audioTime: 1,
            position: { beat: 10.5, passIndex: 0 },
        });
        expect(admitted?.onsetSourceBeat).toBeCloseTo(0.5 + offset, 10);
        admitRecordingMidiExpression({
            channel: 1,
            dimension: 'pressure',
            value: 0.5,
            audioTime: 1.25,
            position: { beat: 11, passIndex: 0 },
        });
        expect(admitted?.expressionChanges?.[0]?.sourceBeat).toBeCloseTo(1 + offset, 10);
        admitRecordingMidiNoteOff({
            channel: 1,
            note: 60,
            audioTime: 1.5,
            position: { beat: 11.5, passIndex: 0 },
        });
        expect(admitted?.releaseSourceBeat).toBeCloseTo(1.5 + offset, 10);
        expect(admitted?.releaseAudioTime).toBe(1.5);
    });
});
