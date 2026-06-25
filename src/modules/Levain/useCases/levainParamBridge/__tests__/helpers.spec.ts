import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../../stores/levainStore';
import { camelToSnake, createLevainBridge, type LevainDevice } from '../helpers';

describe('camelToSnake', () => {
    it('should insert underscores before capitals', () => {
        expect(camelToSnake('attackTime')).toBe('attack_time');
    });

    it('should leave lowercase-only strings unchanged', () => {
        expect(camelToSnake('release')).toBe('release');
    });
});

// ---------------------------------------------------------------------------
// createLevainBridge — engine forwarding behaviour
// ---------------------------------------------------------------------------

type AutoLoad = (deviceId: string, port: MessagePort, instrumentId: string, signal?: AbortSignal) => Promise<void>;

function makeDeps(autoLoad: AutoLoad = vi.fn(() => Promise.resolve())) {
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        autoLoadLevainSamples: vi.fn(autoLoad) as unknown as AutoLoad & ReturnType<typeof vi.fn>,
    };
}

function makeDevice(): LevainDevice & { setParam: ReturnType<typeof vi.fn>; handleCc: ReturnType<typeof vi.fn> } {
    return {
        setParam: vi.fn(),
        handleCc: vi.fn(),
        setInstrument: vi.fn(),
    };
}

function seedDevice(deviceId: string): void {
    levainStore.set({
        [deviceId]: { ...defaultLevainState, patch: createDefaultPatch('violin-1') },
    });
}

describe('createLevainBridge', () => {
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        levainStore.set({});
        rafCallbacks = [];
        // Run the rAF batcher synchronously on demand so we can flush queued params.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function flushRaf(): void {
        const pending = rafCallbacks;
        rafCallbacks = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    describe('fix 1 — register-time vibrato uses the cents slot, not the CC slot', () => {
        // vibratoDepthMax is in cents (default 40). The CC-scaled slot
        // 'vibrato_depth' would saturate it to ~2x; the runtime panel path sends
        // 'expression_vibrato_depth_max'. Register-time must match that key.
        it('forwards vibratoDepthMax to expression_vibrato_depth_max', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const port = {} as MessagePort;

            bridge.registerLevainDevice('d1', makeDevice(), port);
            flushRaf();

            const cents = createDefaultPatch('violin-1').expression.vibratoDepthMax;
            expect(deps.persistDeviceParam).toHaveBeenCalledWith('d1', 'expression_vibrato_depth_max', cents);
            expect(deps.persistDeviceParam).not.toHaveBeenCalledWith('d1', 'vibrato_depth', expect.anything());
        });
    });

    describe('fix 5 — Space macro drives the room mic (index 2)', () => {
        it('writes mic_2_volume, not mic_1_volume, for the Space macro', () => {
            const deps = makeDeps();
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            seedDevice('d1');
            bridge.registerLevainDevice('d1', device, {} as MessagePort);
            device.setParam.mockClear();

            // 'Space' is macro index 4 in the default labels.
            bridge.setMacroWithAudio('d1', 4, 0.7);

            const keys = device.setParam.mock.calls.map((c) => c[0]);
            expect(keys).toContain('mic_2_volume');
            expect(keys).not.toContain('mic_1_volume');
            expect(device.setParam).toHaveBeenCalledWith('mic_2_volume', 0.7);
        });
    });

    describe('fix 2 — a newer load supersedes the previous one', () => {
        it('aborts the in-flight load when a new load for the same device starts', () => {
            const signals: (AbortSignal | undefined)[] = [];
            const autoLoad: AutoLoad = (_d, _p, _i, signal) => {
                signals.push(signal);
                return new Promise(() => {
                    // never resolves — simulates a long-running load
                });
            };
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            const device = makeDevice();
            bridge.registerLevainDevice('d1', device, {} as MessagePort);

            // First load handed out by registration; start a second.
            bridge.loadSamplesForInstrument('d1', 'cello');

            expect(signals.length).toBeGreaterThanOrEqual(2);
            const first = signals[0];
            const second = signals[signals.length - 1];
            expect(first?.aborted).toBe(true);
            expect(second?.aborted).toBe(false);
        });

        it('aborts the in-flight load on unregister', () => {
            const signals: (AbortSignal | undefined)[] = [];
            const autoLoad: AutoLoad = (_d, _p, _i, signal) => {
                signals.push(signal);
                return new Promise(() => {});
            };
            const deps = makeDeps(autoLoad);
            const bridge = createLevainBridge(deps);
            bridge.registerLevainDevice('d1', makeDevice(), {} as MessagePort);

            expect(signals[0]?.aborted).toBe(false);
            bridge.unregisterLevainDevice('d1');
            expect(signals[0]?.aborted).toBe(true);
        });
    });
});
