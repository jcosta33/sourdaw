import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

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
        console: console,
    };

    // We replace the import statements so it doesn't crash on evaluation
    const safeCode = code
        .replace(/import\s+.*?;/g, '')
        .replace(/export\s+/g, '');

    const execute = new Function(
        ...Object.keys(globals),
        `
        ${safeCode}
        return ${className};
        `
    );

    return execute(...Object.values(globals));
}

describe('AudioWorklet Processor Queues (O(1) Array Allocations)', () => {
    
    ['LevainProcessor', 'FermenterProcessor', 'ToasterProcessor'].forEach((processorName) => {
        
        describe(processorName, () => {
            let ProcessorClass: any;
            let processor: any;

            beforeEach(() => {
                const fileName = processorName.charAt(0).toLowerCase() + processorName.slice(1) + '.ts';
                ProcessorClass = loadProcessorClass(`../${fileName}`, processorName);
                processor = new ProcessorClass();
                
                // Mock out the dispatch method to just record the messages
                processor._dispatch = function(msg: any) {
                    if (!this.dispatched) this.dispatched = [];
                    this.dispatched.push(msg);
                };
            });

            it('should enqueue messages in order of sampleFrame', () => {
                processor._enqueue({ sampleFrame: 10, val: 'b' });
                processor._enqueue({ sampleFrame: 5, val: 'a' });
                processor._enqueue({ sampleFrame: 15, val: 'c' });

                expect(processor._queueLength).toBe(3);
                expect(processor._queue[0]).toEqual({ sampleFrame: 5, val: 'a' });
                expect(processor._queue[1]).toEqual({ sampleFrame: 10, val: 'b' });
                expect(processor._queue[2]).toEqual({ sampleFrame: 15, val: 'c' });
            });

            it('should drain queue correctly based on blockEndFrame and shift remaining items without allocating', () => {
                processor._enqueue({ sampleFrame: 10, val: 'a' });
                processor._enqueue({ sampleFrame: 20, val: 'b' });
                processor._enqueue({ sampleFrame: 30, val: 'c' });
                processor._enqueue({ sampleFrame: 40, val: 'd' });

                expect(processor._queueLength).toBe(4);

                // Drain up to frame 25 (should dispatch a and b)
                processor._drainQueue(25);

                expect(processor.dispatched).toEqual([
                    { sampleFrame: 10, val: 'a' },
                    { sampleFrame: 20, val: 'b' },
                ]);

                // The queue length should be reduced to 2
                expect(processor._queueLength).toBe(2);
                
                // The remaining items should be shifted to the front
                expect(processor._queue[0]).toEqual({ sampleFrame: 30, val: 'c' });
                expect(processor._queue[1]).toEqual({ sampleFrame: 40, val: 'd' });
                
                // The old positions should be null to prevent memory leaks
                expect(processor._queue[2]).toBeNull();
                expect(processor._queue[3]).toBeNull();
            });

            it('should not enqueue if queue is full', () => {
                const maxQueue = processor._queue.length;
                for (let i = 0; i < maxQueue; i++) {
                    processor._enqueue({ sampleFrame: i });
                }
                expect(processor._queueLength).toBe(maxQueue);

                // This should print a warning and not increase the queue length or crash
                processor._enqueue({ sampleFrame: maxQueue + 1 });
                expect(processor._queueLength).toBe(maxQueue);
            });
        });
    });
});