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

    it('forwards panic note-offs back through the node port', () => {
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

        harness.port.postMessage({ type: 'allNotesOff', nowSamples: 512 });

        expect(messages).toEqual([
            {
                type: 'notesOff',
                events: [{ timeSamples: 512, kind: { type: 'noteOff', channel: 0, note: 60 } }],
            },
        ]);
        expect(harness.processor.port.postMessage).toHaveBeenCalledWith({
            type: 'notesOff',
            events: [{ timeSamples: 512, kind: { type: 'noteOff', channel: 0, note: 60 } }],
        });
    });

    it('emits exactly one positive acknowledgement through the connected port after the rack accepts it', () => {
        const harness = createWorkletPortHarness();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        harness.port.postMessage({
            type: 'setProjection',
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
