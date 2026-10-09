import { describe, expect, it } from 'vitest';

import { captureCommandTargetFingerprints } from '../captureCommandTargetFingerprints';
import {
    COMMAND_COUNT_IN_TARGET_ID,
    COMMAND_LOOP_TARGET_ID,
    COMMAND_MARKERS_TARGET_ID,
    COMMAND_METRONOME_TARGET_ID,
    COMMAND_PUNCH_TARGET_ID,
    COMMAND_PRE_ROLL_TARGET_ID,
    COMMAND_SECTIONS_TARGET_ID,
    COMMAND_TEMPO_TARGET_ID,
    COMMAND_TIME_SIGNATURE_MAP_TARGET_ID,
} from '../getCommandDivergenceTargetIds';

describe('captureCommandTargetFingerprints', () => {
    it('produces the same fingerprint when object keys have different enumeration order', () => {
        const first = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Vocal',
                    devices: [{ id: 'device-1', parameterValues: { threshold: -18 }, type: 'compressor' }],
                },
            ],
        };
        const second = {
            tracks: [
                {
                    devices: [{ type: 'compressor', parameterValues: { threshold: -18 }, id: 'device-1' }],
                    name: 'Vocal',
                    id: 'track-1',
                },
            ],
        };

        expect(captureCommandTargetFingerprints({ document: first, targetIds: ['track-1'] })).toEqual(
            captureCommandTargetFingerprints({ document: second, targetIds: ['track-1'] })
        );
    });

    it('fingerprints targetless arrangement collections independently', () => {
        const document = {
            markers: {
                markers: [{ beat: 0, color: '#0088ff', id: 'marker-1', name: 'Verse' }],
                sections: [{ color: '#ffaa00', endBeat: 16, id: 'section-1', name: 'Verse', startBeat: 0 }],
            },
        };

        expect(
            captureCommandTargetFingerprints({
                document,
                targetIds: [COMMAND_MARKERS_TARGET_ID, COMMAND_SECTIONS_TARGET_ID],
            })
        ).toEqual({
            [COMMAND_MARKERS_TARGET_ID]: expect.any(String),
            [COMMAND_SECTIONS_TARGET_ID]: expect.any(String),
        });
    });

    it('fingerprints each durable targetless transport control without coupling unrelated fields', () => {
        const base = {
            transport: {
                isLooping: false,
                countInBars: 1,
                countInEnabled: false,
                loopEnd: 16,
                loopStart: 0,
                metronomeEnabled: true,
                metronomeVolume: 0.7,
                punchInBeat: 4,
                punchInEnabled: false,
                punchOutBeat: 12,
                preRollBars: 1,
                preRollEnabled: false,
            },
            timeSignatureMap: { changes: [{ beat: 0, denominator: 4, numerator: 4 }] },
        };
        const targets = [
            COMMAND_LOOP_TARGET_ID,
            COMMAND_PUNCH_TARGET_ID,
            COMMAND_METRONOME_TARGET_ID,
            COMMAND_COUNT_IN_TARGET_ID,
            COMMAND_PRE_ROLL_TARGET_ID,
            COMMAND_TIME_SIGNATURE_MAP_TARGET_ID,
        ];
        const before = captureCommandTargetFingerprints({ document: base, targetIds: targets });
        const afterMetronomeChange = captureCommandTargetFingerprints({
            document: { ...base, transport: { ...base.transport, metronomeVolume: 0.5 } },
            targetIds: targets,
        });

        expect(afterMetronomeChange[COMMAND_LOOP_TARGET_ID]).toBe(before[COMMAND_LOOP_TARGET_ID]);
        expect(afterMetronomeChange[COMMAND_PUNCH_TARGET_ID]).toBe(before[COMMAND_PUNCH_TARGET_ID]);
        expect(afterMetronomeChange[COMMAND_COUNT_IN_TARGET_ID]).toBe(before[COMMAND_COUNT_IN_TARGET_ID]);
        expect(afterMetronomeChange[COMMAND_PRE_ROLL_TARGET_ID]).toBe(before[COMMAND_PRE_ROLL_TARGET_ID]);
        expect(afterMetronomeChange[COMMAND_TIME_SIGNATURE_MAP_TARGET_ID]).toBe(
            before[COMMAND_TIME_SIGNATURE_MAP_TARGET_ID]
        );
        expect(afterMetronomeChange[COMMAND_METRONOME_TARGET_ID]).not.toBe(before[COMMAND_METRONOME_TARGET_ID]);
    });
});

function liveTrack(devices: readonly Record<string, unknown>[]): Record<string, unknown> {
    return {
        clips: [{ endBeat: 4, id: 'clip-1', startBeat: 0 }],
        devices,
        id: 'trk',
        name: 'Track',
        sends: [{ busId: 'bus-1', level: 0.5 }],
    };
}

function drive(value: number): Record<string, unknown> {
    return { id: 'device-1', parameterValues: { drive: value }, type: 'saturator' };
}

function projectWithStoredArrangement(input: {
    live: readonly Record<string, unknown>[];
    stored: readonly Record<string, unknown>[];
}): Record<string, unknown> {
    return {
        arrangements: {
            activeArrangementId: 'arrangement-1',
            arrangements: [{ id: 'arrangement-1', tracks: { selectedTrackId: null, tracks: input.stored } }],
        },
        tracks: { selectedTrackId: null, tracks: input.live },
    };
}

describe('captureCommandTargetFingerprints stored arrangement copies', () => {
    const targetIds = ['trk', 'device-1', 'device-1:drive', 'clip-1'];

    it('does not fingerprint a device removed from the live track while a stored arrangement keeps it', () => {
        const fingerprints = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({
                live: [liveTrack([])],
                stored: [liveTrack([drive(0.4)])],
            }),
            targetIds,
        });

        expect(fingerprints['device-1']).toBeUndefined();
        expect(fingerprints['device-1:drive']).toBeUndefined();
        expect(fingerprints.trk).toBeDefined();
    });

    it('does not fingerprint a track removed from the live project while a stored arrangement keeps it', () => {
        const fingerprints = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({ live: [], stored: [liveTrack([drive(0.4)])] }),
            targetIds,
        });

        expect(fingerprints).toEqual({});
    });

    it('keeps a target fingerprint unchanged when only its stored arrangement copy is edited', () => {
        const live = [liveTrack([drive(0.4)])];
        const before = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({ live, stored: [liveTrack([drive(0.4)])] }),
            targetIds,
        });
        const after = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({ live, stored: [liveTrack([drive(0.9)])] }),
            targetIds,
        });

        expect(Object.keys(before).toSorted()).toEqual(['clip-1', 'device-1', 'device-1:drive', 'trk']);
        expect(after).toEqual(before);
    });

    it('changes a target fingerprint when the live target is edited', () => {
        const stored = [liveTrack([drive(0.4)])];
        const before = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({ live: [liveTrack([drive(0.4)])], stored }),
            targetIds,
        });
        const after = captureCommandTargetFingerprints({
            document: projectWithStoredArrangement({ live: [liveTrack([drive(0.9)])], stored }),
            targetIds,
        });

        expect(after['device-1']).not.toBe(before['device-1']);
        expect(after['device-1:drive']).not.toBe(before['device-1:drive']);
        expect(after.trk).not.toBe(before.trk);
        expect(after['clip-1']).toBe(before['clip-1']);
    });

    it('fingerprints the live slots of every other target kind with a stored arrangement present', () => {
        const live = {
            automation: { lanes: [{ id: 'lane-1', parameterId: 'device-1:drive', points: [], trackId: 'trk' }] },
            markers: {
                markers: [{ beat: 0, id: 'marker-1', name: 'Verse' }],
                sections: [{ endBeat: 16, id: 'section-1', name: 'Verse', startBeat: 0 }],
            },
            timeSignatureMap: { changes: [{ beat: 0, denominator: 4, numerator: 4 }] },
            tracks: {
                selectedTrackId: null,
                tracks: [liveTrack([drive(0.4)]), { id: 'bus-1', kind: 'bus', name: 'Bus' }],
            },
            transport: { tempo: 120 },
        };
        const withStored = {
            ...live,
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [
                    {
                        automation: { lanes: [{ id: 'lane-1', parameterId: 'stale', points: [], trackId: 'trk' }] },
                        id: 'arrangement-1',
                        markers: { markers: [{ beat: 8, id: 'marker-1', name: 'Stale' }], sections: [] },
                        tracks: { selectedTrackId: null, tracks: [liveTrack([drive(0.1)])] },
                    },
                ],
            },
        };
        const targets = [
            'bus-1',
            'lane-1',
            'marker-1',
            'section-1',
            COMMAND_MARKERS_TARGET_ID,
            COMMAND_SECTIONS_TARGET_ID,
            COMMAND_TEMPO_TARGET_ID,
            COMMAND_TIME_SIGNATURE_MAP_TARGET_ID,
        ];

        const fingerprints = captureCommandTargetFingerprints({ document: withStored, targetIds: targets });

        expect(Object.keys(fingerprints).toSorted()).toEqual([...targets].toSorted());
        expect(fingerprints).toEqual(captureCommandTargetFingerprints({ document: live, targetIds: targets }));
    });
});
