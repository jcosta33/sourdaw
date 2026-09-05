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
                queued: [stamp(100), stamp(200), stamp(300), stamp(500)],
            },
            {
                target: TARGET_B,
                writes: [],
                cursor: 0,
                queued: [stamp(150), stamp(300), stamp(600)],
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

/**
 * Device parameters carry differently from strip positions (#3568), on both
 * halves of what this function does.
 *
 * They key differently: the engine charges a device stamp against
 * `(effect, parameter)`, so two parameters of one plugin are two queues and
 * folding them onto one key would carry a stamp into a queue that never held
 * it.
 *
 * And they prune differently: `QueueBudgets::apply_seek` in
 * `crates/sourdaw-native/src/commands/graph.rs` walks the strip automation
 * depths only. A device stamp at or past the seek frame is still charged after
 * the locate, so dropping it here frees a slot the engine has not released and
 * the next pass over-admits into a full queue.
 */
describe('carryQueuedStamps — device parameters', () => {
    const paramSeven: LiveAutomationWriterTarget['target'] = {
        kind: 'device-parameter',
        trackId: 'track-1',
        deviceId: 'plugin-1',
        parameterId: '7',
    };
    const paramNine: LiveAutomationWriterTarget['target'] = { ...paramSeven, parameterId: '9' };

    it('carries two parameters of one device to their own queues, not to each other’s', () => {
        // The incoming pass already holds parameter 7, so a key that named only
        // the device would match parameter 9's outgoing slot to it — parameter
        // 7 would inherit stamps it never issued and parameter 9 would lose
        // every stamp the engine is still charging it for.
        const from: LiveAutomationWriterTarget[] = [
            { target: paramSeven, writes: [], cursor: 0, queued: [stamp(100)] },
            { target: paramNine, writes: [], cursor: 0, queued: [stamp(200)] },
        ];
        const to: LiveAutomationWriterTarget[] = [{ target: paramSeven, writes: [], cursor: 0, queued: [] }];

        carryQueuedStamps(from, to);

        expect(to).toHaveLength(2);
        expect(to.find((slot) => slot.target === paramSeven)?.queued).toEqual([stamp(100)]);
        expect(to.find((slot) => slot.target === paramNine)?.queued).toEqual([stamp(200)]);
    });

    it('keeps device stamps at or past a seek frame while pruning the strip’s', () => {
        const from: LiveAutomationWriterTarget[] = [
            { target: TARGET_A, writes: [], cursor: 0, queued: [stamp(100), stamp(400)] },
            { target: paramSeven, writes: [], cursor: 0, queued: [stamp(100), stamp(400)] },
        ];
        const to: LiveAutomationWriterTarget[] = [];

        carryQueuedStamps(from, to, 300);

        expect(to.find((slot) => slot.target.kind === 'track-fader')?.queued).toEqual([stamp(100)]);
        expect(to.find((slot) => slot.target.kind === 'device-parameter')?.queued).toEqual([stamp(100), stamp(400)]);
    });
});
