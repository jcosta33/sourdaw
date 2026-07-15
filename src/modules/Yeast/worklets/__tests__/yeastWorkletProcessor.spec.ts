import { beforeEach, describe, expect, it, vi } from 'vitest';

const rackMocks = vi.hoisted(() => ({
    allNotesOff: vi.fn(() => [{ timeSamples: 512, kind: { type: 'noteOff' as const, channel: 0, note: 60 } }]),
    executeCommand: vi.fn(),
    processBlock: vi.fn(() => []),
    replaceProjection: vi.fn(() => []),
}));

vi.mock('../MidiRack', () => ({
    MidiRack: class {
        allNotesOff = rackMocks.allNotesOff;
        executeCommand = rackMocks.executeCommand;
        processBlock = rackMocks.processBlock;
        replaceProjection = rackMocks.replaceProjection;
    },
}));

type FakePort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
};

type FakeProcessor = {
    port: FakePort;
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

describe('YeastWorkletProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards panic note-offs back through the node port', () => {
        const processor = new Processor();

        processor.port.onmessage?.({ data: { type: 'allNotesOff', nowSamples: 512 } } as MessageEvent);

        expect(rackMocks.allNotesOff).toHaveBeenCalledWith(512);
        expect(processor.port.postMessage).toHaveBeenCalledWith({
            type: 'notesOff',
            events: [{ timeSamples: 512, kind: { type: 'noteOff', channel: 0, note: 60 } }],
        });
    });

    it('acknowledges a typed one-shot command only after the rack accepts it', () => {
        const processor = new Processor();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        rackMocks.executeCommand.mockReturnValueOnce(true);

        processor.port.onmessage?.({ data: { type: 'executeCommand', commandId: 7, command } } as MessageEvent);

        expect(rackMocks.executeCommand).toHaveBeenCalledTimes(1);
        expect(rackMocks.executeCommand).toHaveBeenCalledWith(command);
        expect(processor.port.postMessage).toHaveBeenCalledWith({
            type: 'commandAck',
            commandId: 7,
            accepted: true,
        });
    });

    it('propagates executeCommand false as a negative acknowledgement', () => {
        const processor = new Processor();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        rackMocks.executeCommand.mockReturnValueOnce(false);

        processor.port.onmessage?.({ data: { type: 'executeCommand', commandId: 8, command } } as MessageEvent);

        expect(processor.port.postMessage).toHaveBeenCalledWith({
            type: 'commandAck',
            commandId: 8,
            accepted: false,
        });
    });

    it('catches command execution failures and acknowledges them as rejected', () => {
        const processor = new Processor();
        const command = { processorId: 'cm-1', type: 'chordMemory.clear' } as const;
        rackMocks.executeCommand.mockImplementationOnce(() => {
            throw new Error('processor failed');
        });

        processor.port.onmessage?.({ data: { type: 'executeCommand', commandId: 9, command } } as MessageEvent);

        expect(processor.port.postMessage).toHaveBeenCalledWith({
            type: 'commandAck',
            commandId: 9,
            accepted: false,
            error: 'processor failed',
        });
    });
});
