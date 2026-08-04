import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';

const mocks = vi.hoisted(() => ({
    getToasterDeviceControls: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    getToasterControls: vi.fn(),
    getTrackStrip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

// `getTrackStrip` is how `setPadParamImmediate` reaches the live worklet. Stubbed
// to "no strip", which is the real state during an offline render: the store write
// still happens, which is the half this spec is about.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getToasterDeviceControls: mocks.getToasterDeviceControls,
    getTrackStrip: mocks.getTrackStrip,
}));

vi.mock('../getToasterControls', () => ({ getToasterControls: mocks.getToasterControls }));

import { toToasterKitState } from '../../models/ToasterKitState';
import { registerToasterDevice, toasterStore } from '../../stores/toasterStore';
import { getToasterPresetKit } from '../getToasterPresetKit';
import { loadToasterKitPreset } from '../loadToasterKit';
import { prepareOfflineToaster } from '../prepareOfflineToaster';
import { setPadParamImmediate } from '../setPadParamImmediate';
import { TOASTER_ENGINE_MAP } from '../toasterEngineMap';
import { initToasterSubscribers } from '../toasterSubscriber';

const DEVICE_ID = 'toaster-1';

/**
 * The engine index each pad holds when nothing configures it — `ToasterEngine::new`
 * (`crates/daw-dsp/src/toaster/engine.rs`) read through the `engine_type` match
 * arms in `pad.rs`. Rendering this instead of the project's kit is the defect.
 */
const RUST_DEFAULT_ENGINE_INDEX_BY_PAD = [0, 1, 2, 2, 3, 12, 5, 5, 5, 6, 6, 9, 10, 11, 4, 4] as const;

type Message =
    { type: 'param'; name: string; value: number } | { type: 'padParam'; pad: number; name: string; value: number };

function makeRecordingPort(): { port: MessagePort; sent: Message[] } {
    const sent: Message[] = [];
    const port = {
        postMessage: (message: Message) => {
            sent.push(message);
        },
    } as unknown as MessagePort;
    return { port, sent };
}

/**
 * Capture what the live subscriber pushes, normalised into the same message shape
 * the offline path posts. `ToasterNode.setParam`/`setPadParam` are literally
 * `postMessage({ type: 'param' | 'padParam', … })`, so this is the live wire
 * traffic, not a re-encoding of it.
 */
function captureLiveMessages(): Message[] {
    const sent: Message[] = [];
    mocks.getToasterDeviceControls.mockReturnValue({
        setParam: (name: string, value: number) => {
            sent.push({ type: 'param', name, value });
        },
        setPadParam: (pad: number, name: string, value: number) => {
            sent.push({ type: 'padParam', pad, name, value });
        },
    });

    const handlers: Array<(payload: { deviceId: string; deviceType: string }) => void> = [];
    const eventBus = {
        on: (_event: string, handler: (payload: { deviceId: string; deviceType: string }) => void) => {
            handlers.push(handler);
            return () => {};
        },
    };
    const logger = { info: vi.fn() } as unknown as Logger;
    initToasterSubscribers({ eventBus, logger });
    handlers[0]?.({ deviceId: DEVICE_ID, deviceType: 'toaster' });

    return sent;
}

function padValue(sent: Message[], pad: number, name: string): number | undefined {
    for (const message of sent) {
        if (message.type === 'padParam' && message.pad === pad && message.name === name) {
            return message.value;
        }
    }
    return undefined;
}

describe('Toaster live/offline parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        toasterStore.set({});
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: DEVICE_ID,
        });
        mocks.getToasterControls.mockReturnValue(undefined);
    });

    afterEach(() => {
        toasterStore.set({});
    });

    /**
     * AC-003: the fixture reaches its non-default configuration through the real
     * live use case the UI calls, not by seeding the store.
     *
     * This matters more than it looks. An earlier attempt at this fix seeded
     * `toasterStore` directly and produced a green mutation score against a state
     * production could not reach — at the time nothing created a store record at
     * all, so every assertion pinned an unreachable branch while reading as proof.
     * Driving `registerToasterDevice` + `setPadParamImmediate` means the state under
     * test is the state a user editing pads actually produces.
     */
    function editPadsThroughTheLiveUseCase(): void {
        registerToasterDevice(DEVICE_ID);
        // Values chosen to differ from `Pad::new`'s defaults (volume 0.8, tune 0,
        // decay 0.5, tone 0.5, drive 0, sends 0) so rendering an unconfigured
        // engine cannot satisfy them. Do not tidy these towards the defaults.
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 1, key: 'volume', value: 0.42 });
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 1, key: 'tune', value: -7 });
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 1, key: 'decay', value: 0.13 });
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 1, key: 'drive', value: 6.5 });
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 1, key: 'sendReverb', value: 0.77 });
    }

    it('posts the pad edits a user made through the panel, not the engine defaults', () => {
        editPadsThroughTheLiveUseCase();
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: DEVICE_ID, port });

        expect(padValue(sent, 1, 'volume')).toBe(0.42);
        expect(padValue(sent, 1, 'tune')).toBe(-7);
        expect(padValue(sent, 1, 'decay')).toBe(0.13);
        expect(padValue(sent, 1, 'drive')).toBe(6.5);
        expect(padValue(sent, 1, 'send_reverb')).toBe(0.77);
    });

    it('posts an engine type that is not the one the engine would pick for itself', () => {
        registerToasterDevice(DEVICE_ID);
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: DEVICE_ID, port });

        // engine_type selects the synthesis model, so it is the strongest
        // discriminator: the application kit is the 808/909 circuit-faithful set
        // and the engine constructs itself with the generic voices.
        expect(padValue(sent, 0, 'engine_type')).toBe(TOASTER_ENGINE_MAP['kick-808']);
        expect(padValue(sent, 0, 'engine_type')).not.toBe(RUST_DEFAULT_ENGINE_INDEX_BY_PAD[0]);
        expect(padValue(sent, 1, 'engine_type')).toBe(TOASTER_ENGINE_MAP['snare-808']);
        expect(padValue(sent, 1, 'engine_type')).not.toBe(RUST_DEFAULT_ENGINE_INDEX_BY_PAD[1]);
    });

    it('projects persisted kit state when the transient session store is empty', () => {
        const kit = getToasterPresetKit('fm-metallic');
        if (kit === null) {
            throw new Error('expected the FM preset fixture');
        }
        const deviceState = toToasterKitState(kit);
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: DEVICE_ID, deviceState, port });

        expect(padValue(sent, 1, 'engine_type')).toBe(TOASTER_ENGINE_MAP['fm-perc']);
        expect(padValue(sent, 1, 'mod_ratio')).toBe(2.3);
        expect(padValue(sent, 1, 'mod_amount')).toBe(3);
        expect(padValue(sent, 1, 'feedback')).toBe(0.2);
        expect(sent).toContainEqual({ type: 'param', name: 'master_gain', value: kit.masterGain });
    });

    /**
     * The property the owner actually cares about: an export sounds like the
     * session. Stronger than either side being individually correct, because it
     * fails if the two ever diverge for any reason — a field added to one
     * projection caller, a filter applied on one side only, an ordering change.
     */
    it('posts exactly what the live subscriber posts, for the same device', () => {
        editPadsThroughTheLiveUseCase();

        const live = captureLiveMessages();
        const { port, sent: offline } = makeRecordingPort();
        prepareOfflineToaster({ deviceId: DEVICE_ID, port });

        expect(offline).toEqual(live);
        // Guard against the assertion passing because both are empty.
        expect(offline.length).toBeGreaterThan(16 * 10);
    });

    it('keeps preset voicing identical across initial load, runtime reload, and offline render', () => {
        const kit = getToasterPresetKit('fm-metallic');
        if (kit === null) {
            throw new Error('expected the FM preset fixture');
        }
        registerToasterDevice(DEVICE_ID);

        const initial: Message[] = [];
        mocks.getToasterControls.mockReturnValue({
            setParam: (name: string, value: number) => initial.push({ type: 'param', name, value }),
            setPadParam: (pad: number, name: string, value: number) =>
                initial.push({ type: 'padParam', pad, name, value }),
        });
        loadToasterKitPreset(DEVICE_ID, kit);

        const reloaded = captureLiveMessages();
        const { port, sent: offline } = makeRecordingPort();
        prepareOfflineToaster({ deviceId: DEVICE_ID, port });

        expect(reloaded).toEqual(initial);
        expect(offline).toEqual(initial);
        expect(padValue(initial, 1, 'mod_ratio')).toBe(2.3);
        expect(padValue(initial, 1, 'mod_amount')).toBe(3);
        expect(padValue(initial, 1, 'feedback')).toBe(0.2);
    });

    it('projects the application default kit when no persisted or transient state exists', () => {
        const live = captureLiveMessages();
        toasterStore.set({});
        const { port, sent: offline } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'never-registered', port });

        expect(offline).toEqual(live);
        expect(padValue(offline, 0, 'engine_type')).toBe(TOASTER_ENGINE_MAP['kick-808']);
        expect(offline.length).toBeGreaterThan(16 * 10);
    });

    it('never posts a non-finite value, matching the guard ToasterNode applies live', () => {
        registerToasterDevice(DEVICE_ID);
        setPadParamImmediate({ deviceId: DEVICE_ID, padIndex: 0, key: 'decay', value: Number.NaN });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: DEVICE_ID, port });

        expect(sent.every((message) => Number.isFinite(message.value))).toBe(true);
        expect(padValue(sent, 0, 'decay')).toBeUndefined();
        // One bad field drops that field only.
        expect(padValue(sent, 0, 'engine_type')).toBe(TOASTER_ENGINE_MAP['kick-808']);
    });
});
