import fs from 'fs';
import path from 'path';

import { describe, it, expect, beforeEach } from 'vitest';

// Helper to evaluate an AudioWorklet script and extract its class
function loadProcessorClass(filePath: string, className: string) {
    const code = fs.readFileSync(path.resolve(__dirname, filePath), 'utf-8');

    // Mock global AudioWorklet environment
    const globals = {
        AudioWorkletProcessor: class {
            port = {
                onmessage: null as any,
                postMessage: () => {},
            };
        },
        registerProcessor: () => {},
        currentFrame: 0,
        sampleRate: 48000,
        console,
    };

    // We replace the import statements so it doesn't crash on evaluation
    const safeCode = code.replaceAll(/import\s+.*?;/g, '').replaceAll(/export\s+/g, '');

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
