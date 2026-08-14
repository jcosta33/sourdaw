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
