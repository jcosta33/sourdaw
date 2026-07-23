import fs from 'fs';
import path from 'path';

import ts from 'typescript';
import { describe, it, expect, beforeEach } from 'vitest';

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
    for (const processorName of ['LevainProcessor', 'FermenterProcessor', 'ToasterProcessor']) {
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
        });
    }
});

describe('FermenterProcessor parameter automation', () => {
    it('writes exact ramp and step values inside one render quantum', () => {
        const ProcessorClass = loadProcessorClass('../fermenterProcessor.ts', 'FermenterProcessor');
        const processor = new ProcessorClass();
        processor._automationValues = new Float32Array(15 * 129);
        processor._ready = true;
        processor.port.onmessage({
            data: {
                type: 'paramAutomation',
                paramId: 1,
                segments: [
                    { startFrame: 0, endFrame: 64, startValue: 200, endValue: 1_000 },
                    { startFrame: 64, endFrame: 64, startValue: 2_000, endValue: 2_000 },
                ],
            },
        });

        expect(processor._writeParamAutomation(0, 128)).toBe(true);

        const offset = 15 + 128;
        expect(processor._automationValues[1]).toBe(128);
        expect(processor._automationValues[offset]).toBe(200);
        expect(processor._automationValues[offset + 32]).toBe(600);
        expect(processor._automationValues[offset + 63]).toBe(987.5);
        expect(processor._automationValues[offset + 64]).toBe(2_000);
    });
});
