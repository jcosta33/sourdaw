import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));

const faustNodeMocks = vi.hoisted(() => ({ createFaustDeviceNode: vi.fn() }));
vi.mock('../../useCases/deviceResolvers/createFaustDeviceNode', () => ({
    createFaustDeviceNode: faustNodeMocks.createFaustDeviceNode,
}));

import { asAudioNode, createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { trackStore } from '#/modules/Arrangement/stores';
import { getFaustModuleLatencyMs, registerBuiltinFaustDSP } from '#/modules/PluginHost/useCases';

import { externalLatencyRegistry } from '../../useCases/latencyCompensation/compensation/externalLatencyRegistry';
import { getCompensationDelay } from '../../useCases/latencyCompensation/compensation/getCompensationDelay';
import { getTrackLatency } from '../../useCases/latencyCompensation/compensation/getTrackLatency';
import { findWasmDescriptor } from '../wasmDeviceRegistry';

/**
 * The Brick-Wall Limiter's look-ahead is a real delay line in the compiled
 * node. An unreported delay slides the track hosting it against every other
 * track, against a parallel dry bus, and against the other stems of an export
 * — the failure has no sound of its own, it just moves everything else.
 *
 * Two halves have to hold for the alignment to survive, and this spec pins
 * both: the DSP delays by exactly the constant it declares, and the engine
 * reports that constant to plugin-delay compensation when the device is
 * created.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/brick-wall-limiter.dsp';
const LIMITER_TYPE = 'faust-brick-wall-limiter';
const SAMPLE_RATE = 48_000;

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

function faustDeviceNodeResult() {
    const node = createMockAudioNode('audio-worklet');
    return {
        inputNode: asAudioNode(node),
        outputNode: asAudioNode(node),
        nodes: [asAudioNode(node)],
        wamControls: {
            setParam: vi.fn(),
            scheduleParam: vi.fn(),
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            destroy: vi.fn(),
        },
    };
}

/** Create one Faust device through the registry, exactly as TrackNode does. */
async function createFaustDevice(deviceId: string, deviceType: string): Promise<void> {
    faustNodeMocks.createFaustDeviceNode.mockResolvedValue(faustDeviceNodeResult());
    const descriptor = findWasmDescriptor(deviceType);
    if (!descriptor) {
        throw new Error(`no wasm descriptor matches ${deviceType}`);
    }
    const { loadPromise } = descriptor.create({
        context: createMockAudioContext() as unknown as AudioContext,
        deviceId,
        deviceType,
        onLoaded: vi.fn(),
    });
    await loadPromise;
}

/** A limiter on `master`, and a `dry` track that bypasses it. */
function twoTrackProject(): void {
    mockTrackStore.value = {
        tracks: [
            {
                id: 'master',
                kind: 'audio',
                outputId: 'hw_out',
                devices: [
                    {
                        id: 'dev-limiter',
                        name: 'Brick-Wall Limiter',
                        type: LIMITER_TYPE,
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
                sends: [],
            },
            { id: 'dry', kind: 'audio', outputId: 'hw_out', devices: [], sends: [] },
        ],
    };
}

describe('Brick-Wall Limiter look-ahead reaches plugin-delay compensation', () => {
    beforeEach(() => {
        registerBuiltinFaustDSP();
        mockTrackStore.value = null;
        externalLatencyRegistry.clear();
        faustNodeMocks.createFaustDeviceNode.mockReset();
    });

    it('declares the same delay the DSP implements', () => {
        // The DSP's constant and the engine's reported figure are two copies of
        // one number in two languages. This is what stops them drifting.
        const source = readFileSync(DSP_FILE, 'utf8');
        const declared = /^MAX_LOOKAHEAD_S = ([\d.]+);/m.exec(source);
        expect(declared, `${DSP_FILE} no longer declares MAX_LOOKAHEAD_S`).not.toBeNull();
        expect(Number(declared![1]) * 1000).toBe(getFaustModuleLatencyMs(LIMITER_TYPE));
    });

    it('reports the module latency when the device is created', async () => {
        await createFaustDevice('dev-limiter', LIMITER_TYPE);

        expect(externalLatencyRegistry.get('dev-limiter')).toBe(getFaustModuleLatencyMs(LIMITER_TYPE));
    });

    it('lands the same click on the same sample on both tracks', async () => {
        twoTrackProject();
        await createFaustDevice('dev-limiter', LIMITER_TYPE);

        // The same click is placed at the same frame on both tracks. The
        // limiter's own delay line pushes its copy back by the module's
        // latency; PDC has to push the dry copy back by the identical amount,
        // or the two arrive as a flam.
        const clickFrame = 24_000;
        const limiterDelaySamples = Math.round((getFaustModuleLatencyMs(LIMITER_TYPE) / 1000) * SAMPLE_RATE);
        expect(limiterDelaySamples, 'the limiter must actually delay something').toBeGreaterThan(0);

        const limiterArrival = clickFrame + limiterDelaySamples;
        const dryArrival = clickFrame + Math.round(getCompensationDelay('dry') * SAMPLE_RATE);

        expect(dryArrival).toBe(limiterArrival);
        // And the limiter's own track is the late one, so it gets no extra push.
        expect(getCompensationDelay('master')).toBe(0);
        expect(getTrackLatency('master').totalLatencyMs).toBe(getFaustModuleLatencyMs(LIMITER_TYPE));
    });

    it('reports zero for a Faust module that carries no delay line', async () => {
        await createFaustDevice('dev-gain', 'faust-gain-utility');

        expect(externalLatencyRegistry.get('dev-gain')).toBe(0);
    });
});
