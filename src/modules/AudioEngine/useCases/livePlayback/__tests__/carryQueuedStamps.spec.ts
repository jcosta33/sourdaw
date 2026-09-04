import { describe, expect, it } from 'vitest';

import { type AudioGraphStripParameterTarget } from '../../../models/AudioGraphBackend';
import { carryQueuedStamps } from '../carryQueuedStamps';
import { type LiveAutomationQueuedStamp, type LiveAutomationWriterTarget } from '../nativeLiveAutomationWriterState';

const TARGET_A: AudioGraphStripParameterTarget = { kind: 'track-fader', trackId: 'track-1' };
const TARGET_B: AudioGraphStripParameterTarget = { kind: 'track-pan', trackId: 'track-1' };
const TARGET_C: AudioGraphStripParameterTarget = {
    kind: 'track-send-level',
    trackId: 'track-1',
    busId: 'bus-1',
};

function stamp(startFrame: number, landFrame: number = startFrame): LiveAutomationQueuedStamp {
    return { startFrame, landFrame, admittedBatch: 1, seamAnchor: null };
}

describe('carryQueuedStamps', () => {
    it('retains unlanded stamps for target slots not present in the incoming pass', () => {
        const from: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [stamp(100), stamp(200)],
            },
            {
                target: TARGET_B,
                writes: [],
                cursor: 0,
                queued: [stamp(300), stamp(400)],
            },
        ];
        const to: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [],
            },
        ];

        carryQueuedStamps(from, to);

        expect(to).toEqual([
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [stamp(100), stamp(200)],
            },
            {
                target: TARGET_B,
                writes: [],
                cursor: 0,
                queued: [stamp(300), stamp(400)],
            },
        ]);
    });

    it('filters retained stamps by seekFrame when provided', () => {
        const from: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [stamp(100), stamp(200), stamp(500)],
            },
            {
                target: TARGET_B,
                writes: [],
                cursor: 0,
                queued: [stamp(150), stamp(600)],
            },
        ];
        const to: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [],
            },
        ];

        carryQueuedStamps(from, to, 300);

        expect(to).toEqual([
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [stamp(100), stamp(200)],
            },
            {
                target: TARGET_B,
                writes: [],
                cursor: 0,
                queued: [stamp(150)],
            },
        ]);
    });

    it('does not append targets from "from" if they have zero queued stamps', () => {
        const from: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [stamp(100)],
            },
            {
                target: TARGET_C,
                writes: [],
                cursor: 0,
                queued: [],
            },
        ];
        const to: LiveAutomationWriterTarget[] = [
            {
                target: TARGET_A,
                writes: [],
                cursor: 0,
                queued: [],
            },
        ];

        carryQueuedStamps(from, to);

        expect(to).toHaveLength(1);
        expect(to[0]?.target).toEqual(TARGET_A);
        expect(to[0]?.queued).toEqual([stamp(100)]);
    });
});
