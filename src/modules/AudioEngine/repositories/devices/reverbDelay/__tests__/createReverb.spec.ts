import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReverb } from '../createReverb';

function createBuffer(length: number): AudioBuffer {
    const channels = [new Float32Array(length), new Float32Array(length)];
    return {
        getChannelData: (channel: number) => channels[channel]!,
    } as AudioBuffer;
}

function createNode() {
    return {
        connect: vi.fn(),
        gain: { value: 0 },
        delayTime: { value: 0 },
        frequency: { value: 0 },
        Q: { value: 0 },
        type: '',
    };
}

describe('createReverb', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reuses one deterministic impulse for every reverb in the same context', () => {
        const convolvers: Array<ReturnType<typeof createNode> & { buffer: AudioBuffer | null }> = [];
        const createContextBuffer = vi.fn((_channels: number, length: number) => createBuffer(length));
        const context = {
            sampleRate: 10,
            createBuffer: createContextBuffer,
            createGain: () => createNode(),
            createDelay: () => createNode(),
            createBiquadFilter: () => createNode(),
            createConvolver: () => {
                const convolver = { ...createNode(), buffer: null as AudioBuffer | null };
                convolvers.push(convolver);
                return convolver;
            },
        } as unknown as BaseAudioContext;
        vi.stubGlobal(
            'AudioBuffer',
            class {
                constructor({ length }: { length: number }) {
                    return createBuffer(length);
                }
            }
        );
        const random = vi.spyOn(Math, 'random');

        createReverb(context);
        createReverb(context);

        expect(createContextBuffer).toHaveBeenCalledTimes(1);
        expect(convolvers[0]?.buffer).toBe(convolvers[1]?.buffer);
        expect(random).not.toHaveBeenCalled();
        expect([...convolvers[0]!.buffer!.getChannelData(0)]).not.toEqual([
            ...convolvers[0]!.buffer!.getChannelData(1),
        ]);
    });
});
