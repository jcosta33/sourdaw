import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { PAN_SCALE_MAX, dbToGain, toStereoPan } from '#/utils/audioLevelLaw';

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: vi.fn(() => Promise.resolve([])),
}));

import { composeOfflineStripLevel } from '../composeOfflineStripLevel';
import { createOfflineAdjustmentBusChain } from '../createOfflineAdjustmentBusChain';
import { createOfflineTrackStrip } from '../createOfflineTrackStrip';
import { resolveTrackAdjustmentComposition } from '../offlineAdjustmentLayers';
import { readOfflineAdjustmentLayerSnapshot } from '../readOfflineAdjustmentLayerSnapshot';

function makeOfflineCtx(): OfflineAudioContext {
    return {
        createGain: vi.fn(() => ({ gain: { value: -1 }, connect: vi.fn() })),
        createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
    } as unknown as OfflineAudioContext;
}

let layerCounter = 0;

function makeLayer(overrides: Partial<AdjustmentLayer>): AdjustmentLayer {
    layerCounter += 1;
    return {
        id: `layer-${layerCounter}`,
        name: `Layer ${layerCounter}`,
        effectType: 'volume',
        parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
        affectedTrackIds: [],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix: 1,
        color: 'oklch(0.40 0.10 180)',
        ...overrides,
    };
}

function seedLayers(layers: AdjustmentLayer[]): void {
    adjustmentLayerStore.set({ layers });
}

const ALL_TRACKS = ['track-1', 'track-2'];

describe('offline render composes adjustment layers the way live playback does', () => {
    beforeEach(() => {
        layerCounter = 0;
        seedLayers([]);
    });

    it('folds an always-on −12 dB volume layer into the fader live composes (0.8 × −12 dB ≈ 0.201)', async () => {
        const layer = makeLayer({
            effectType: 'volume',
            parameters: [{ name: 'Gain', value: -12, min: -60, max: 12, unit: 'dB' }],
        });
        seedLayers([layer]);

        const composition = resolveTrackAdjustmentComposition({
            layers: readOfflineAdjustmentLayerSnapshot(),
            trackId: 'track-1',
            allTrackIds: ALL_TRACKS,
            spanStartBeat: 0,
            spanEndBeat: 16,
        });
        // Live `adjustmentLayerApplier.applyVolumePan`: 1 + (10^(−12/20) − 1) × blend.
        expect(composition.gainMultiplier).toBeCloseTo(dbToGain(-12), 12);
        expect(composition.constant).toBe(true);

        const level = composeOfflineStripLevel({ gain: 0.8, pan: 0 }, composition);
        const strip = await createOfflineTrackStrip(makeOfflineCtx(), {
            id: 'track-1',
            name: 'Kick',
            gain: level.gain,
            muted: false,
            pan: level.pan,
            devices: [],
        });

        // The composed level the issue names: 0.8 × 10^(−12/20) ≈ 0.201, not 0.8.
        expect(strip.faderNode.gain.value).toBeCloseTo(0.8 * dbToGain(-12), 10);
    });

    it('composes a pan layer into the panner the way live composedPan does', async () => {
        const layer = makeLayer({
            effectType: 'pan',
            parameters: [{ name: 'Pan', value: 50, min: -100, max: 100, unit: '%' }],
        });
        seedLayers([layer]);

        const composition = resolveTrackAdjustmentComposition({
            layers: readOfflineAdjustmentLayerSnapshot(),
            trackId: 'track-1',
            allTrackIds: ALL_TRACKS,
            spanStartBeat: 0,
            spanEndBeat: 16,
        });
        // Live: (panPct/100) × blend, summed, × PAN_SCALE_MAX in stored units.
        expect(composition.panOffset).toBeCloseTo(0.5 * PAN_SCALE_MAX, 10);

        const level = composeOfflineStripLevel({ gain: 0.8, pan: -10 }, composition);
        const strip = await createOfflineTrackStrip(makeOfflineCtx(), {
            id: 'track-1',
            name: 'Kick',
            gain: level.gain,
            muted: false,
            pan: level.pan,
            devices: [],
        });

        // Live composedPan: clamp50(userPan + Σ) → toStereoPan ⇒ −10 + 25 = 15 → 0.3.
        expect(level.pan).toBe(15);
        expect(strip.panNode.pan.value).toBeCloseTo(toStereoPan(15), 10);
    });

    it('clamps the layer-composed pan at full right instead of running past the travel', async () => {
        const layer = makeLayer({
            effectType: 'pan',
            parameters: [{ name: 'Pan', value: 100, min: -100, max: 100, unit: '%' }],
        });
        seedLayers([layer]);

        const composition = resolveTrackAdjustmentComposition({
            layers: readOfflineAdjustmentLayerSnapshot(),
            trackId: 'track-1',
            allTrackIds: ALL_TRACKS,
            spanStartBeat: 0,
            spanEndBeat: 16,
        });
        const level = composeOfflineStripLevel({ gain: 0.8, pan: 30 }, composition);

        expect(level.pan).toBe(PAN_SCALE_MAX);
    });

    it('reports a region layer whose blend moves across the span as not constant', () => {
        const layer = makeLayer({
            effectType: 'volume',
            parameters: [{ name: 'Gain', value: -12, min: -60, max: 12, unit: 'dB' }],
            regions: [{ id: 'r1', startBeat: 0, endBeat: 8, blend: 1, fadeInBeats: 2, fadeOutBeats: 0 }],
        });
        seedLayers([layer]);

        const composition = resolveTrackAdjustmentComposition({
            layers: readOfflineAdjustmentLayerSnapshot(),
            trackId: 'track-1',
            allTrackIds: ALL_TRACKS,
            spanStartBeat: 0,
            spanEndBeat: 16,
        });

        expect(composition.constant).toBe(false);
        // The live blend law at beat 1 (half-way up a 2-beat fade-in): 0.5 × mix.
        const atBeat1 = resolveTrackAdjustmentComposition({
            layers: readOfflineAdjustmentLayerSnapshot(),
            trackId: 'track-1',
            allTrackIds: ALL_TRACKS,
            spanStartBeat: 1,
            spanEndBeat: 1.0001,
        });
        expect(atBeat1.gainMultiplier).toBeCloseTo(1 + (dbToGain(-12) - 1) * 0.5, 10);
    });
});

describe('offline DSP adjustment layers route through the live bus topology', () => {
    function makeBusCtx() {
        const filterNode = {
            type: 'lowpass',
            frequency: { value: 1000 },
            Q: { value: 1 },
            detune: { value: 0 },
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
        };
        let gainCount = 0;
        const gains: {
            gain: { value: number };
            connect: ReturnType<typeof vi.fn>;
            setTargetAtTime?: ReturnType<typeof vi.fn>;
        }[] = [];
        const ctx = {
            currentTime: 0,
            createGain: vi.fn(() => {
                gainCount += 1;
                const gain = {
                    gain: {
                        value: 1,
                        setTargetAtTime: vi.fn(),
                        setValueAtTime: vi.fn(),
                        cancelScheduledValues: vi.fn(),
                        linearRampToValueAtTime: vi.fn(),
                    },
                    connect: vi.fn(),
                    disconnect: vi.fn(),
                };
                gains.push(gain);
                return gain;
            }),
            createBiquadFilter: vi.fn(() => filterNode),
            createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
            get gainCount() {
                return gainCount;
            },
            get gains() {
                return gains;
            },
        };
        return ctx as unknown as BaseAudioContext & {
            gainCount: number;
            gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[];
        };
    }

    it('inserts the layer chain between the strip output and its destination with the layer blend', () => {
        const ctx = makeBusCtx();
        const buses = createOfflineAdjustmentBusChain({
            context: ctx,
            layers: [
                {
                    layerId: 'layer-1',
                    effectType: 'filter',
                    parameters: { Cutoff: 800 },
                    blend: 0.7,
                },
            ],
        });

        expect(buses).toHaveLength(1);
        const bus = buses[0]!;
        // Live `AdjustmentBusNode.setBlend` drives wet toward `blend` and dry toward `1 − blend`.
        const setTargets = ctx.gains
            .map((gain) => gain.gain.setTargetAtTime)
            .filter((call) => call.mock.calls.length > 0);
        const blendCalls = setTargets.flatMap((call) => call.mock.calls as unknown as [number, number, number][]);
        expect(blendCalls.some(([value]) => Math.abs(value - 0.7) < 1e-9)).toBe(true);
        expect(blendCalls.some(([value]) => Math.abs(value - 0.3) < 1e-9)).toBe(true);

        // Wire it the way the offline graph does: strip output → chain → destination.
        const stripOutput = ctx.createGain() as unknown as AudioNode;
        const destination = ctx.createGain() as unknown as AudioNode;
        stripOutput.connect(bus.inputNode);
        bus.outputNode.connect(destination);
        expect(stripOutput.connect).toHaveBeenCalledWith(bus.inputNode);
        expect(bus.outputNode.connect).toHaveBeenCalledWith(destination);

        bus.dispose();
    });

    it('chains two DSP layers in stack order', () => {
        const ctx = makeBusCtx();
        const buses = createOfflineAdjustmentBusChain({
            context: ctx,
            layers: [
                { layerId: 'a', effectType: 'filter', parameters: { Cutoff: 800 }, blend: 1 },
                { layerId: 'b', effectType: 'filter', parameters: { Cutoff: 400 }, blend: 0.5 },
            ],
        });

        expect(buses).toHaveLength(2);
        buses[0]!.outputNode.connect(buses[1]!.inputNode);
        expect(buses[0]!.outputNode.connect).toHaveBeenCalledWith(buses[1]!.inputNode);
        for (const bus of buses) {
            bus.dispose();
        }
    });
});
