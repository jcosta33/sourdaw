import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';
import type { MidiProcessor } from '../MidiProcessor';
import type { MidiRack } from '../MidiRack';

type FakePort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
};

type FakeProcessor = {
    port: FakePort;
    _rack: MidiRack;
};

const registeredProcessor = vi.fn();

class FakeAudioWorkletProcessor {
    port: FakePort = {
        onmessage: null,
        postMessage: vi.fn(),
    };
}

vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
vi.stubGlobal('currentFrame', 128);
vi.stubGlobal('registerProcessor', registeredProcessor);

await import('../yeastWorkletProcessor');

const Processor = registeredProcessor.mock.calls[0]?.[1] as new () => FakeProcessor;

function createWorkletPortHarness(): { processor: FakeProcessor; port: FakePort } {
    const processor = new Processor();
    const port: FakePort = {
        onmessage: null,
        postMessage: vi.fn((message: unknown) => {
            processor.port.onmessage?.({ data: message } as MessageEvent);
        }),
    };

    processor.port.postMessage = vi.fn((message: unknown) => {
        port.onmessage?.({ data: message } as MessageEvent);
    });

    return { processor, port };
}

function makeThrowingProcessor(executeCommand: ReturnType<typeof vi.fn>): MidiProcessor {
    return {
        id: 'cm-throw',
        name: 'Throwing processor',
        processMidi: () => {},
        reset: () => {},
        setBypassed: () => {},
        isBypassed: () => false,
        setParam: () => {},
        executeCommand,
        latencySamples: () => 0,
    };
}

describe('YeastWorkletProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('carries panic note-offs inside the correlated acknowledgement', () => {
        const harness = createWorkletPortHarness();
        const noteOn: MidiEvent = {
            timeSamples: 0,
            kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
        };
        harness.processor._rack.processBlock([noteOn], 0, 128, {} as TransportInfo);
        const messages: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            messages.push(data);
        };

        harness.port.postMessage({ type: 'allNotesOff', panicId: 7, nowSamples: 512 });

        expect(messages).toEqual([
            {
                type: 'allNotesOffAck',
                panicId: 7,
                completed: true,
                events: [{ timeSamples: 512, kind: { type: 'noteOff', channel: 0, note: 60 } }],
            },
        ]);
        expect(harness.processor.port.postMessage.mock.calls).toEqual([
            [
                {
                    type: 'allNotesOffAck',
                    panicId: 7,
                    completed: true,
                    events: [{ timeSamples: 512, kind: { type: 'noteOff', channel: 0, note: 60 } }],
                },
            ],
        ]);
    });

    it('acknowledges a panic even when no notes are active', () => {
        const harness = createWorkletPortHarness();
        const messages: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            messages.push(data);
        };

        harness.port.postMessage({ type: 'allNotesOff', panicId: 8, nowSamples: 512 });

        expect(messages).toEqual([{ type: 'allNotesOffAck', panicId: 8, completed: true, events: [] }]);
    });

    it('ignores an allNotesOff envelope without a valid panic id', () => {
        const harness = createWorkletPortHarness();
        const allNotesOff = vi.spyOn(harness.processor._rack, 'allNotesOff');

        harness.port.postMessage({ type: 'allNotesOff', panicId: '8', nowSamples: 512 });

        expect(allNotesOff).not.toHaveBeenCalled();
    });

    it('returns a negative acknowledgement when rack panic execution throws', () => {
        const harness = createWorkletPortHarness();
        const error = new Error('rack panic failed');
        vi.spyOn(harness.processor._rack, 'allNotesOff').mockImplementation(() => {
            throw error;
        });
        const messages: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            messages.push(data);
        };

        harness.port.postMessage({ type: 'allNotesOff', panicId: 9, nowSamples: 512 });

        expect(messages).toEqual([{ type: 'allNotesOffAck', panicId: 9, completed: false, error: error.message }]);
    });

    it('emits exactly one positive acknowledgement through the connected port after the rack accepts it', () => {
        const harness = createWorkletPortHarness();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        harness.port.postMessage({
            type: 'setProjection',
            projectionId: 0,
            processors: [{ id: 'cm-1', type: 'chordMemory', bypassed: false, params: {} }],
        });

        const acknowledgements: unknown[] = [];
        let executeReturned = false;
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            acknowledgements.push(data);
            if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'commandAck') {
                expect(executeReturned).toBe(true);
            }
        };
        const originalExecuteCommand = harness.processor._rack.executeCommand.bind(harness.processor._rack);
        const executeCommand = vi.spyOn(harness.processor._rack, 'executeCommand').mockImplementation((value) => {
            const accepted = originalExecuteCommand(value);
            executeReturned = accepted === true;
            return accepted;
        });

        harness.port.postMessage({ type: 'executeCommand', commandId: 7, command });

        expect(executeCommand).toHaveBeenCalledTimes(1);
        expect(executeCommand).toHaveBeenCalledWith(command);
        expect(acknowledgements).toHaveLength(1);
        expect(acknowledgements[0]).toEqual({
            type: 'commandAck',
            commandId: 7,
            accepted: true,
        });
    });

    it('reports projection execution failures with the correlated projection id', () => {
        const harness = createWorkletPortHarness();
        const error = new Error('projection failed');
        vi.spyOn(harness.processor._rack, 'replaceProjection').mockImplementation(() => {
            throw error;
        });
        const messages: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            messages.push(data);
        };

        harness.port.postMessage({
            type: 'setProjection',
            projectionId: 7,
            processors: [],
        });

        expect(messages).toEqual([
            {
                type: 'projectionError',
                projectionId: 7,
                error: error.message,
            },
        ]);
    });

    it('carries projection note-offs inside the correlated acknowledgement', () => {
        const harness = createWorkletPortHarness();
        const messages: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            messages.push(data);
        };

        harness.port.postMessage({
            type: 'setProjection',
            projectionId: 0,
            processors: [{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }],
        });
        messages.length = 0;
        harness.processor._rack.processBlock(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            0,
            128,
            {} as TransportInfo
        );
        harness.port.postMessage({
            type: 'setProjection',
            projectionId: 8,
            processors: [],
        });

        expect(messages).toEqual([
            {
                type: 'projectionAck',
                projectionId: 8,
                events: [{ timeSamples: 128, kind: { type: 'noteOff', channel: 0, note: 60 } }],
            },
        ]);
    });

    it('emits exactly one negative acknowledgement without an error when the rack rejects', () => {
        const harness = createWorkletPortHarness();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        const acknowledgements: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            acknowledgements.push(data);
        };

        harness.port.postMessage({ type: 'executeCommand', commandId: 8, command });

        expect(acknowledgements).toHaveLength(1);
        expect(acknowledgements[0]).toEqual({
            type: 'commandAck',
            commandId: 8,
            accepted: false,
        });
    });

    it('emits exactly one negative acknowledgement with the thrown error message', () => {
        const harness = createWorkletPortHarness();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        const executeCommand = vi.fn((): boolean => {
            throw new Error('processor failed');
        });
        harness.processor._rack.addProcessor(makeThrowingProcessor(executeCommand), 'chordMemory');
        const acknowledgements: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            acknowledgements.push(data);
        };

        harness.port.postMessage({
            type: 'executeCommand',
            commandId: 9,
            command: { ...command, processorId: 'cm-throw' },
        });

        expect(executeCommand).toHaveBeenCalledTimes(1);
        expect(acknowledgements).toHaveLength(1);
        expect(acknowledgements[0]).toEqual({
            type: 'commandAck',
            commandId: 9,
            accepted: false,
            error: 'processor failed',
        });
    });

    it('rejects malformed execute envelopes without crashing or faking acceptance', () => {
        const harness = createWorkletPortHarness();
        const acknowledgements: unknown[] = [];
        harness.port.onmessage = ({ data }: MessageEvent<unknown>) => {
            acknowledgements.push(data);
        };

        expect(() => {
            harness.port.postMessage({ type: 'executeCommand', commandId: 10, command: null });
        }).not.toThrow();
        harness.port.postMessage({
            type: 'executeCommand',
            commandId: '10',
            command: { processorId: 'cm-1', type: 'chordMemory.clear' },
        });

        expect(acknowledgements).toEqual([
            {
                type: 'commandAck',
                commandId: 10,
                accepted: false,
                error: 'Invalid executeCommand message',
            },
        ]);
    });
});
