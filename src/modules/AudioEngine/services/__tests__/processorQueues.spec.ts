import fs from 'fs';
import path from 'path';

import ts from 'typescript';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The eval harness strips imports from the processor source, so any symbol a
// processor imports and references at class-eval time (WasmView is used in field
// initializers) must be re-supplied as an injected global. The real class is used.
import { WasmView } from '../wasmView';

// Helper to evaluate an AudioWorklet script and extract its class
function loadProcessorClass(filePath: string, className: string) {
    const code = fs.readFileSync(path.resolve(__dirname, filePath), 'utf-8');

    // Mock global AudioWorklet environment. `exports` is a no-op stub so TS's
    // emitted `Object.defineProperty(exports, '__esModule', ...)` line doesn't
    // crash inside `new Function`.
    const globals = {
        AudioWorkletProcessor: class {
            port = {
                onmessage: null as ((event: MessageEvent) => void) | null,
                postMessage: () => {},
            };
        },
        registerProcessor: () => {},
        currentFrame: 0,
        sampleRate: 48000,
        console,
        WasmView,
    };

    // Strip TypeScript types so `new Function` can parse pure JS. Use ESNext
    // module mode so imports stay as `import ... from ...;` (easy to regex
    // out) instead of becoming CommonJS `require(...)` (which has no loader
    // inside `new Function`).
    const transpiled = ts.transpileModule(code, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            isolatedModules: true,
            removeComments: false,
        },
    }).outputText;
    const safeCode = transpiled.replaceAll(/^import\s+.*?;$/gm, '').replaceAll(/^export\s+/gm, '');

    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test utility: dynamically loads AudioWorkletProcessor source to extract class; no user input
    const execute = new Function(
        ...Object.keys(globals),
        `
        ${safeCode}
        return ${className};
        `
    );

    return execute(...Object.values(globals));
}

describe('AudioWorklet Processor Queues (_queueHead Read Index)', () => {
    for (const processorName of ['LevainProcessor', 'FermenterProcessor', 'ToasterProcessor', 'CrumbsProcessor']) {
        describe(processorName, () => {
            let ProcessorClass: any;
            let processor: any;

            beforeEach(() => {
                const fileName = `${processorName.charAt(0).toLowerCase() + processorName.slice(1)}.ts`;
                ProcessorClass = loadProcessorClass(`../${fileName}`, processorName);
                processor = new ProcessorClass();

                // Mock out the dispatch method to just record the messages
                processor._dispatch = function (msg: any) {
                    if (!this.dispatched) {
                        this.dispatched = [];
                    }
                    this.dispatched.push(msg);
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
    it('evaluates compiled automation at render-quantum boundaries', () => {
        const ProcessorClass = loadProcessorClass('../fermenterProcessor.ts', 'FermenterProcessor');
        const processor = new ProcessorClass();
        const applied: Array<{ paramId: number; value: number }> = [];
        processor._instance = {
            set_param_by_id(paramId: number, value: number) {
                applied.push({ paramId, value });
            },
        };
        processor._ready = true;
        processor.port.onmessage({
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
});

describe('ProofChamberProcessor parameter automation', () => {
    it('interpolates a compiled segment at render quantum boundaries', () => {
        const ProcessorClass = loadProcessorClass('../proofChamberProcessor.ts', 'ProofChamberProcessor');
        const processor = new ProcessorClass();
        const setParam = vi.fn();
        processor._instance = { set_param_by_id: setParam };
        processor.port.onmessage({
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
