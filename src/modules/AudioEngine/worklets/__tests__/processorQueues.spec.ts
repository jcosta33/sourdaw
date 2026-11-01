import { describe, it, expect, beforeEach, vi } from 'vitest';

import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../models/FermenterAutomationParams';

import { loadWorkletProcessor } from './workletBundleHarness';

// Every processor here is evaluated from the bundled artifact the app loads
// (`?worker&url` + `worker.format: 'iife'`), not from regex-stripped source, so
// there is no list of injected globals to keep in step with the processors'
// imports. See `workletBundleHarness.ts` for the three times the old harness
// broke on an import that was correct in production.

type QueuedMessage = { sampleFrame: number; val: string };

type QueueProcessor = {
    _queue: QueuedMessage[];
    _queueHead: number;
    _enqueue(message: QueuedMessage): void;
    _drainQueue(blockEndFrame: number): void;
    _dispatch(message: QueuedMessage): void;
    dispatched?: QueuedMessage[];
};

type ParamSetter = (paramId: number, value: number) => void;

type AutomationProcessor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null };
    _instance: { set_param_by_id: ParamSetter } | null;
    _ready: boolean;
    _applyParamAutomation(frame: number): void;
};

const QUEUE_PROCESSORS = [
    { entryFileName: 'levainProcessor.ts', registeredName: 'levain-processor' },
    { entryFileName: 'toasterProcessor.ts', registeredName: 'toaster-processor' },
    { entryFileName: 'crumbsProcessor.ts', registeredName: 'crumbs-processor' },
] as const;

describe('AudioWorklet Processor Queues (_queueHead Read Index)', () => {
    for (const { entryFileName, registeredName } of QUEUE_PROCESSORS) {
        describe(registeredName, () => {
            let processor: QueueProcessor;

            beforeEach(async () => {
                const ProcessorClass = await loadWorkletProcessor<QueueProcessor>({ entryFileName, registeredName });
                processor = new ProcessorClass();

                // Mock out the dispatch method to just record the messages
                processor._dispatch = function (message: QueuedMessage) {
                    if (!this.dispatched) {
                        this.dispatched = [];
                    }
                    this.dispatched.push(message);
                };
            });

            it('should enqueue messages in order of sampleFrame', () => {
                processor._enqueue({ sampleFrame: 10, val: 'b' });
                processor._enqueue({ sampleFrame: 5, val: 'a' });
                processor._enqueue({ sampleFrame: 15, val: 'c' });

                expect(processor._queue.length).toBe(3);
                expect(processor._queue[0]).toEqual({ sampleFrame: 5, val: 'a' });
                expect(processor._queue[1]).toEqual({ sampleFrame: 10, val: 'b' });
                expect(processor._queue[2]).toEqual({ sampleFrame: 15, val: 'c' });
            });

            it('should drain queue correctly based on blockEndFrame and advance _queueHead', () => {
                processor._enqueue({ sampleFrame: 10, val: 'a' });
                processor._enqueue({ sampleFrame: 20, val: 'b' });
                processor._enqueue({ sampleFrame: 30, val: 'c' });
                processor._enqueue({ sampleFrame: 40, val: 'd' });

                expect(processor._queue.length).toBe(4);

                // Drain up to frame 25 (should dispatch a and b)
                processor._drainQueue(25);

                expect(processor.dispatched).toEqual([
                    { sampleFrame: 10, val: 'a' },
                    { sampleFrame: 20, val: 'b' },
                ]);

                // The queue length shouldn't change yet, but head should advance
                expect(processor._queueHead).toBe(2);
                expect(processor._queue.length).toBe(4);

                // Drain the rest
                processor._drainQueue(45);
                expect(processor.dispatched).toEqual([
                    { sampleFrame: 10, val: 'a' },
                    { sampleFrame: 20, val: 'b' },
                    { sampleFrame: 30, val: 'c' },
                    { sampleFrame: 40, val: 'd' },
                ]);

                // Once fully drained, it should clear in place
                expect(processor._queueHead).toBe(0);
                expect(processor._queue.length).toBe(0);
            });

            it('treats blockEndFrame as exclusive: a frame exactly on the bound waits for the next block', () => {
                processor.dispatched = [];
                processor._enqueue({ sampleFrame: 128, val: 'onBound' });
                processor._enqueue({ sampleFrame: 200, val: 'later' });

                // Block [0, 127]: the bound 128 is the FIRST frame of the next
                // block, so nothing here is due yet. Every other case in this
                // spec keeps queued frames strictly inside the bound, which is
                // why a `>` vs `>=` drain reads identically to them.
                processor._drainQueue(128);
                expect(processor.dispatched).toEqual([]);
                expect(processor._queueHead).toBe(0);

                // Block [128, 255]: bound 256 now covers frame 128.
                processor._drainQueue(256);
                expect(processor.dispatched).toEqual([
                    { sampleFrame: 128, val: 'onBound' },
                    { sampleFrame: 200, val: 'later' },
                ]);
                expect(processor._queueHead).toBe(0);
                expect(processor._queue.length).toBe(0);
            });
        });
    }
});

describe('FermenterProcessor parameter automation', () => {
    let processor: AutomationProcessor;

    beforeEach(async () => {
        const ProcessorClass = await loadWorkletProcessor<AutomationProcessor>({
            entryFileName: 'fermenterProcessor.ts',
            registeredName: 'fermenter-processor',
        });
        processor = new ProcessorClass();
    });

    it('evaluates compiled automation at render-quantum boundaries', () => {
        const applied: Array<{ paramId: number; value: number }> = [];
        processor._instance = {
            set_param_by_id(paramId: number, value: number) {
                applied.push({ paramId, value });
            },
        };
        processor._ready = true;
        processor.port.onmessage?.({
            data: {
                type: 'paramAutomation',
                paramId: 1,
                segments: [
                    { startFrame: 0, endFrame: 1_000, startValue: 200, endValue: 2_000 },
                    { startFrame: 1_000, endFrame: 1_000, startValue: 2_000, endValue: 2_000 },
                ],
            },
        });

        processor._applyParamAutomation(0);
        processor._applyParamAutomation(500);
        processor._applyParamAutomation(500);
        processor._applyParamAutomation(1_000);

        expect(applied).toEqual([
            { paramId: 1, value: 200 },
            { paramId: 1, value: 1_100 },
            { paramId: 1, value: 2_000 },
        ]);
    });

    // The bundled worklet derives its ordinal bound from the imported
    // `FERMENTER_AUTOMATION_PARAM_IDS` table (`models/FermenterAutomationParams`).
    // A worklet that restates that bound as a literal — as it did before #1351,
    // when a hard-coded `15` silently dropped every `oscWaveform` (ordinal 15)
    // automation message — disagrees with the table and fails here.
    //
    // This assertion is only reachable at all because the harness evaluates the
    // bundle: the old source-stripping harness deleted that import and could
    // only see the table if it was hand-injected as a global.
    const highestOrdinal = Math.max(...Object.values(FERMENTER_AUTOMATION_PARAM_IDS));
    const firstInvalidOrdinal = Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).length;

    function scheduleOrdinal(target: AutomationProcessor, paramId: number): number[] {
        const applied: number[] = [];
        target._instance = {
            set_param_by_id(appliedId: number) {
                applied.push(appliedId);
            },
        };
        target._ready = true;
        target.port.onmessage?.({
            data: {
                type: 'paramAutomation',
                paramId,
                segments: [{ startFrame: 0, endFrame: 100, startValue: 0, endValue: 1 }],
            },
        });
        target._applyParamAutomation(100);
        return applied;
    }

    it(`accepts automation for the highest ordinal in the table (${highestOrdinal})`, () => {
        expect(scheduleOrdinal(processor, highestOrdinal)).toEqual([highestOrdinal]);
    });

    it(`rejects automation one past the table (${firstInvalidOrdinal}), which Rust would index out of range`, () => {
        expect(scheduleOrdinal(processor, firstInvalidOrdinal)).toEqual([]);
    });
});

describe('ProofChamberProcessor parameter automation', () => {
    it('interpolates a compiled segment at render quantum boundaries', async () => {
        const ProcessorClass = await loadWorkletProcessor<AutomationProcessor>({
            entryFileName: 'proofChamberProcessor.ts',
            registeredName: 'proof-chamber-processor',
        });
        const processor = new ProcessorClass();
        const setParam = vi.fn<ParamSetter>();
        processor._instance = { set_param_by_id: setParam };
        processor.port.onmessage?.({
            data: {
                type: 'paramAutomation',
                paramId: 0,
                segments: [{ startFrame: 0, endFrame: 1_000, startValue: 0.2, endValue: 0.8 }],
            },
        });

        processor._applyParamAutomation(0);
        processor._applyParamAutomation(500);
        processor._applyParamAutomation(1_000);

        expect(setParam.mock.calls).toEqual([
            [0, 0.2],
            [0, 0.5],
            [0, 0.8],
        ]);
    });
});
