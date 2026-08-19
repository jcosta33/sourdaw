import { describe, expect, it, vi } from 'vitest';

import { createGrowableMemory, installWorkletGlobals, type GrowableMemory } from './wasmViewGrowthHarness';

type CrustProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
};

const { registry } = installWorkletGlobals<CrustProcessorLike>();
const memory: GrowableMemory = createGrowableMemory(64 * 1024);
const paramCalls: Array<{ name: string; value: number }> = [];

class CrustInstanceMock {
    set_param(name: string, value: number): void {
        paramCalls.push({ name, value });
    }

    get_latency_samples(): number {
        return 0;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    CrustInstance: CrustInstanceMock,
}));

const MINIMAL_WASM_MODULE = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

async function loadProcessor(): Promise<CrustProcessorLike> {
    await import('../crustProcessor');
    const Ctor = registry.get('crust-processor');
    if (!Ctor) {
        throw new Error('crust-processor was not registered');
    }
    return new Ctor({ processorOptions: { wasmModule: MINIMAL_WASM_MODULE } });
}

function send(proc: CrustProcessorLike, data: unknown): void {
    proc.port.onmessage?.({ data });
}

function initializeControl(proc: CrustProcessorLike): void {
    send(proc, {
        schemaVersion: 1,
        command: 'initialize-fallback-control',
        target: {
            trackId: 'track-1',
            deviceId: 'crust-1',
            deviceType: 'crust',
            parameterIds: [
                'gain',
                'ceiling',
                'style',
                'algorithm',
                'lookahead',
                'attack',
                'release',
                'attackAuto',
                'releaseAuto',
                'channelLinkTransient',
                'channelLinkRelease',
                'truePeak',
                'oversampling',
                'satEnabled',
                'satAlgorithm',
                'satDrive',
                'satMix',
                'deltaListen',
                'unityGain',
                'multiBand',
                'crossover1',
                'crossover2',
                'scHpfEnabled',
                'scHpfFreq',
                'stereoMode',
                'dither',
                'outputBitDepth',
                'bypass',
                'resetTruePeak',
            ],
        },
        correlation: { workletGeneration: 1 },
    });
}

function control(
    parameterId: string,
    value: number,
    controlSequence: number,
    scheduling: { targetFrame: number | null; deadlineFrame: number | null } = {
        targetFrame: null,
        deadlineFrame: null,
    }
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: { trackId: 'track-1', deviceId: 'crust-1', deviceType: 'crust', parameterId },
        value,
        correlation: { workletGeneration: 1, controlSequence },
        scheduling,
    };
}

describe('CrustProcessor control protocol', () => {
    it('rejects the legacy raw parameter message before it reaches WASM', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        paramCalls.length = 0;

        send(proc, { type: 'param', name: 'ceiling', value: -1 });

        expect(paramCalls).toEqual([]);
    });

    it('accepts only an in-order immediate envelope with its initialized target', async () => {
        const proc = await loadProcessor();
        send(proc, { type: 'init' });
        initializeControl(proc);
        paramCalls.length = 0;

        send(proc, control('ceiling', -1, 1));
        send(proc, control('unknown', 0.5, 2));
        send(proc, {
            ...control('ceiling', -2, 2),
            target: { trackId: 'track-1', deviceId: 'forged', deviceType: 'crust', parameterId: 'ceiling' },
        });
        send(proc, control('ceiling', -3, 1));
        send(proc, control('ceiling', -4, 2, { targetFrame: 128, deadlineFrame: 256 }));
        send(proc, { ...control('ceiling', -5, 2), value: Number.NaN });

        expect(paramCalls).toEqual([{ name: 'ceiling', value: -1 }]);
    });
});
