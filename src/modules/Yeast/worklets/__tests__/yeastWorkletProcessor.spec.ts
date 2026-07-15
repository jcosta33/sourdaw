import { beforeEach, describe, expect, it, vi } from 'vitest';

const rackMocks = vi.hoisted(() => ({
    allNotesOff: vi.fn(() => [{ timeSamples: 512, kind: { type: 'noteOff' as const, channel: 0, note: 60 } }]),
    processBlock: vi.fn(() => []),
    replaceProjection: vi.fn(() => []),
}));

vi.mock('../MidiRack', () => ({
    MidiRack: class {
        allNotesOff = rackMocks.allNotesOff;
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
});
