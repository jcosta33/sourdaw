import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
import { registerBuiltinFaustDSP } from '#/modules/PluginHost/useCases';

import { type BuiltinDeviceNode } from '../../models/AudioEngineState';
import { getFaustMeterReading } from '../../useCases/engineAccess/getFaustMeterReading';
import { clearFaustMeterReadings } from '../faustMeterReadings';
import { findWasmDescriptor } from '../wasmDeviceRegistry';

/**
 * The LUFS Meter computes momentary/short-term loudness in its DSP and exposes
 * both as vbargraph outputs. The vendored faustwasm carries the audio-side
 * path: the worklet processor posts `{type: "out-param", path, value}` per
 * bargraph (coalesced by the library to every 6th render block), and the
 * main-thread FaustAudioWorkletNode hands those to the handler installed via
 * `setOutputParamHandler`. The defect this spec pins is the missing Sourdaw
 * half: nothing installed that handler, so a bargraph declared in the DSP had
 * no route to the control side and the meter read dead.
 *
 * The stub node below reproduces the vendored node's only relevant behavior —
 * storing the handler, to be invoked per posted out-param — exactly as
 * `FaustAudioWorkletNode.handleMessageAux` dispatches them.
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/lufs-meter.dsp';
const DEVICE_TYPE = 'faust-lufs-meter';

type OutParamHandler = (path: string, value: number) => void;

type OnLoadedMock = Mock<(finalDn: BuiltinDeviceNode) => boolean | void>;

type LoadResult = {
    onLoaded: OnLoadedMock;
    /** The handler the engine installed, as the vendored node stores it. */
    installed: { handler: OutParamHandler | null };
};

/** Create one Faust device through the registry, exactly as TrackNode does. */
async function createFaustDevice(deviceId: string, onLoaded: OnLoadedMock = vi.fn()): Promise<LoadResult> {
    const installed: { handler: OutParamHandler | null } = { handler: null };
    const node = asAudioNode(createMockAudioNode('audio-worklet')) as AudioNode & {
        setOutputParamHandler: (handler: OutParamHandler | null) => void;
    };
    node.setOutputParamHandler = (handler) => {
        installed.handler = handler;
    };
    faustNodeMocks.createFaustDeviceNode.mockResolvedValue({
        inputNode: node,
        outputNode: node,
        nodes: [node],
        wamControls: {
            setParam: vi.fn(),
            scheduleParam: vi.fn(),
            keyOn: vi.fn(),
            keyOff: vi.fn(),
            destroy: vi.fn(),
        },
    });

    const descriptor = findWasmDescriptor(DEVICE_TYPE);
    if (!descriptor) {
        throw new Error(`no wasm descriptor matches ${DEVICE_TYPE}`);
    }
    const { loadPromise } = descriptor.create({
        context: createMockAudioContext() as unknown as AudioContext,
        deviceId,
        deviceType: DEVICE_TYPE,
        onLoaded,
    });
    await loadPromise;
    return { onLoaded, installed };
}

describe('Faust bargraph readings reach the control side', () => {
    beforeEach(() => {
        registerBuiltinFaustDSP();
        faustNodeMocks.createFaustDeviceNode.mockReset();
        for (const deviceId of ['dev-lufs', 'dev-lufs-2', 'dev-a', 'dev-rejected']) {
            clearFaustMeterReadings(deviceId);
        }
    });

    it('declares the two bargraphs the read path keys on, in the DSP', () => {
        // The transport addresses readings by bare bargraph name; if the DSP
        // renames either one, the wiring goes dead silently. Pinned at the
        // declaration so the rename fails here first.
        const source = readFileSync(DSP_FILE, 'utf8');
        expect(source).toMatch(/vbargraph\("momentary"/);
        expect(source).toMatch(/vbargraph\("short_term"/);
    });

    it('installs the out-param handler on the live node and routes posted bargraph values', async () => {
        const { installed } = await createFaustDevice('dev-lufs');

        // The seam itself: the engine must have installed the main-thread
        // handler the vendored node dispatches posted out-param messages to.
        expect(installed.handler, 'the engine installed the out-param handler').toBeTypeOf('function');

        // The vendored node calls this handler per posted out-param message,
        // with the compiled bargraph address. Same call, same shapes.
        installed.handler!('/LUFS_Meter/momentary', -12.3);
        installed.handler!('/LUFS_Meter/short_term', -18.7);

        expect(getFaustMeterReading('dev-lufs', 'momentary')).toBe(-12.3);
        expect(getFaustMeterReading('dev-lufs', 'short_term')).toBe(-18.7);
    });

    it('keys readings per device instance, not per module', async () => {
        const { installed } = await createFaustDevice('dev-a');
        installed.handler!('/LUFS_Meter/momentary', -5);

        expect(getFaustMeterReading('dev-a', 'momentary')).toBe(-5);
        expect(getFaustMeterReading('dev-b', 'momentary')).toBeNull();
    });

    it('detaches the handler and clears readings when the device is destroyed', async () => {
        const { onLoaded, installed } = await createFaustDevice('dev-lufs');
        installed.handler!('/LUFS_Meter/momentary', -12.3);
        expect(getFaustMeterReading('dev-lufs', 'momentary')).toBe(-12.3);

        const [loadedNode] = onLoaded.mock.calls[0] ?? [];
        if (!loadedNode) {
            throw new Error('expected the registry to report the device loaded');
        }
        loadedNode.controller?.destroy();

        expect(installed.handler).toBeNull();
        expect(getFaustMeterReading('dev-lufs', 'momentary')).toBeNull();
    });

    it('leaves no handler on a load the track rejected', async () => {
        const rejectLoad = vi.fn<(finalDn: BuiltinDeviceNode) => boolean>(() => false);
        const { installed } = await createFaustDevice('dev-rejected', rejectLoad);

        expect(installed.handler).toBeNull();
        expect(getFaustMeterReading('dev-rejected', 'momentary')).toBeNull();
    });
});
