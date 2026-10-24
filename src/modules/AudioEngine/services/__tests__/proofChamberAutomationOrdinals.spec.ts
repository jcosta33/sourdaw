import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    clampDeviceParameterValue,
    getBuiltinPlugins,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS } from '../../engine/ProofChamberNode';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import { NativeDspDeviceStrategy } from '../../repositories/deviceStrategy/NativeDspDeviceStrategy';
import { constantTempoProjector } from '../../repositories/offlineScheduler/__tests__/constantTempoProjector';
import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import { initSync, ProofChamberInstance } from '../../wasm/proof_chamber.js';

import { installWorkletGlobals } from './wasmViewGrowthHarness';

import type { OfflineAutomationSegment } from '../../repositories/deviceStrategy/AudioDeviceStrategy';

const RATE = 48_000;
const FRAMES = 128;
const BLOCKS = 560;
const DEVICE_ID = 'dutch-oven-1';
const wasmModule = new WebAssembly.Module(
    readFileSync(resolve(process.cwd(), 'public/wasm/proof-chamber/proof_chamber_bg.wasm'))
);
initSync({ module: wasmModule });

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    _instance: ProofChamberInstance | null;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
const { registry } = installWorkletGlobals<Processor>();

type Fixture = {
    from: number;
    to: number;
    prelude?: readonly (readonly [string, number])[];
    why: string;
};

// The value, engine state and excitation that make each setter audible are
// specified here. Plate accepts all 21 names; the burst is asymmetric stereo
// broadband noise, followed by a charged tail. The EQ values stay below the
// decay ceiling and the output cutoffs leave every band in the stimulus.
const FIXTURES: Readonly<Record<string, Fixture>> = {
    damping: { from: 0.1, to: 0.9, why: 'charged tank high-frequency absorption' },
    predelay: { from: 0, to: 80, why: 'broadband wet onset delay' },
    size: { from: 0.2, to: 0.9, why: 'early reflection spacing' },
    mod_rate: { from: 0.2, to: 4, prelude: [['mod_depth', 0.8]], why: 'tank modulation with nonzero depth' },
    mod_depth: { from: 0, to: 0.9, prelude: [['mod_rate', 3]], why: 'tank modulation with nonzero rate' },
    diffusion: { from: 0.2, to: 0.9, why: 'input allpass gains' },
    high_cut: { from: 2_000, to: 18_000, why: 'broadband wet output high frequencies' },
    low_cut: { from: 30, to: 1_200, why: 'broadband wet output low frequencies' },
    width: { from: 0, to: 2, why: 'asymmetric left and right wet excitation' },
    freeze: { from: 0, to: 1, why: 'charged tank then input and decay gating' },
    shimmer: { from: 0, to: 1, prelude: [['shimmer_amount', 0.9]], why: 'charged tail with pitch-shift feedback' },
    shimmer_amount: { from: 0, to: 0.9, prelude: [['shimmer', 1]], why: 'enabled pitch-shift feedback' },
    gravity: { from: -1, to: 1, why: 'tilted tank diffusion' },
    early_late: { from: 0, to: 1, why: 'early reflection against late tail' },
    density: { from: 0, to: 1, why: 'tank cross-coupling' },
    decay_eq_0: { from: 0.25, to: 4, why: '100 Hz loop rate below decay ceiling' },
    decay_eq_1: { from: 0.25, to: 4, why: '400 Hz loop rate below decay ceiling' },
    decay_eq_2: { from: 0.25, to: 4, why: '1.2 kHz loop rate below decay ceiling' },
    decay_eq_3: { from: 0.25, to: 4, why: '3.5 kHz loop rate below decay ceiling' },
    decay_eq_4: { from: 0.25, to: 4, why: '8 kHz loop rate below decay ceiling' },
    decay_eq_5: { from: 0.25, to: 4, why: '12 kHz loop rate below decay ceiling' },
};

function schedule(name: string, fixture: Fixture, moving: boolean): OfflineAutomationSegment[] {
    const descriptor = getBuiltinPlugins().find((plugin) => plugin.id === 'dutch-oven');
    const parameter = descriptor?.parameters.find((item) => item.id === name);
    if (!parameter || !parameter.automatable) {
        throw new Error(`Dutch Oven descriptor does not admit ${name}`);
    }
    const lane: AutomationLane = {
        id: `lane-${name}`,
        trackId: 'track-1',
        parameterId: `${DEVICE_ID}:${name}`,
        parameterName: name,
        enabled: true,
        minValue: parameter.minValue,
        maxValue: parameter.maxValue,
        points: [
            { beat: 0, value: fixture.from, curve: 'linear', tension: 0 },
            { beat: 1.5, value: moving ? fixture.to : fixture.from, curve: 'linear', tension: 0 },
        ],
    };
    const calls: { name: string; segments: readonly OfflineAutomationSegment[] }[] = [];
    const strategy = new NativeDspDeviceStrategy({
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        acceptsScheduledParam: (candidate) => Object.hasOwn(PROOF_CHAMBER_AUTOMATION_PARAM_IDS, candidate),
        scheduleParam: (candidate, segments) => calls.push({ name: candidate, segments }),
    });
    scheduleTrackAutomation({
        lanes: [lane],
        trackId: 'track-1',
        trackGainNode: { gain: {} } as GainNode,
        trackPanNode: { pan: {} } as StereoPannerNode,
        deviceEntries: [{ deviceId: DEVICE_ID, deviceType: 'dutch-oven', contributesAudio: true, strategy }],
        durationSeconds: (BLOCKS * FRAMES) / RATE,
        changes: [],
        projectBeatToSeconds: constantTempoProjector(120),
        slewTickSeconds: automationSlewTickSecondsForGrain(10),
        sampleRate: RATE,
        compensationDelaySec: 0.008,
        deviceParameterLaw: {
            acceptsAutomation: ({ deviceType, parameterId }) =>
                isDeviceParameterAutomatable({ deviceType, paramId: parameterId }),
            clampValue: clampDeviceParameterValue,
            quantiseValue: quantiseDeviceParameterValue,
        },
        resolveLaneCeiling: (candidate) => candidate.maxValue,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe(name);
    return [...calls[0]!.segments];
}

function sample(segments: readonly OfflineAutomationSegment[], frame: number): number | undefined {
    const active = [...segments].reverse().find((segment) => frame >= segment.startFrame);
    if (!active) {
        return undefined;
    }
    if (frame >= active.endFrame || active.endFrame === active.startFrame) {
        return active.endValue;
    }
    return (
        active.startValue +
        ((frame - active.startFrame) / (active.endFrame - active.startFrame)) * (active.endValue - active.startValue)
    );
}

function expectedCalls(
    segments: readonly OfflineAutomationSegment[],
    ordinal: number
): Array<[number, number, number]> {
    const calls: Array<[number, number, number]> = [];
    let prior: number | undefined;
    for (let block = 0; block < BLOCKS; block++) {
        const value = sample(segments, block * FRAMES);
        if (value !== undefined && value !== prior) {
            calls.push([block * FRAMES, ordinal, value]);
            prior = value;
        }
    }
    return calls;
}

const INPUTS: Float32Array[][] = Array.from({ length: BLOCKS }, (_unused, block) => {
    const left = new Float32Array(FRAMES);
    const right = new Float32Array(FRAMES);
    if (block < 100) {
        let state = (0x2545f491 + block * 2654435761) >>> 0;
        for (let frame = 0; frame < FRAMES; frame++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const noise = ((state >>> 8) / 8388608 - 1) * 0.35;
            left[frame] = noise;
            right[frame] = noise * 0.37;
        }
    }
    return [left, right];
});

type ParamIdSpy = {
    mockClear(): void;
    mock: { calls: Array<Parameters<ProofChamberInstance['set_param_by_id']>> };
};

async function render(
    name: string,
    fixture: Fixture,
    segments: readonly OfflineAutomationSegment[],
    mode: 'by-id' | 'by-name' | 'static',
    spy: ParamIdSpy
): Promise<{ pcm: Float32Array; calls: Array<[number, number, number]> }> {
    await import('../proofChamberProcessor');
    const Constructor = registry.get('proof-chamber-processor');
    if (!Constructor) {
        throw new Error('real ProofChamberProcessor did not register');
    }
    const processor = new Constructor({ processorOptions: { wasmModule } });
    processor.port.onmessage?.({ data: { type: 'init' } });
    const initialWrites: Array<readonly [string, number]> = [
        ['algorithm', 0],
        ['mix', 1],
        ['decay', 0.6],
        ['damping', 0.3],
        ['high_cut', 20_000],
        ['low_cut', 20],
        ['early_late', 0.8],
    ];
    if (fixture.prelude !== undefined) {
        for (const entry of fixture.prelude) {
            initialWrites.push(entry);
        }
    }
    initialWrites.push([name, fixture.from]);
    for (const [parameter, value] of initialWrites) {
        processor.port.onmessage?.({ data: { type: 'param', name: parameter, value } });
    }
    const ordinal = PROOF_CHAMBER_AUTOMATION_PARAM_IDS[name];
    if (ordinal === undefined) {
        throw new Error(`missing automation ordinal for ${name}`);
    }
    if (mode === 'by-id') {
        processor.port.onmessage?.({ data: { type: 'paramAutomation', paramId: ordinal, segments } });
    }
    spy.mockClear();
    const pcm = new Float32Array(BLOCKS * FRAMES * 2);
    const outputs = [[new Float32Array(FRAMES), new Float32Array(FRAMES)]];
    const calls: Array<[number, number, number]> = [];
    let observedCalls = 0;
    let prior: number | undefined;
    for (let block = 0; block < BLOCKS; block++) {
        const frame = block * FRAMES;
        vi.stubGlobal('currentFrame', frame);
        if (mode === 'by-name') {
            const value = sample(segments, frame);
            if (value !== undefined && value !== prior) {
                processor.port.onmessage?.({ data: { type: 'param', name, value } });
                prior = value;
            }
        }
        expect(processor.process([INPUTS[block]!], outputs)).toBe(true);
        while (observedCalls < spy.mock.calls.length) {
            const [id, value] = spy.mock.calls[observedCalls]!;
            calls.push([frame, id, value]);
            observedCalls++;
        }
        for (let i = 0; i < FRAMES; i++) {
            pcm[(block * FRAMES + i) * 2] = outputs[0]![0]![i]!;
            pcm[(block * FRAMES + i) * 2 + 1] = outputs[0]![1]![i]!;
        }
    }
    expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    processor._instance?.free();
    return { pcm, calls };
}

describe('fresh Proof Chamber WASM offline automation', () => {
    it('keeps a nondefault named value before the first scheduled frame', async () => {
        const fixture: Fixture = { from: 0.6, to: 0.8, why: 'stored damping before a delayed lane' };
        const segments = [{ startFrame: 256, endFrame: 512, startValue: 0.2, endValue: 0.8 }];
        const spy = vi.spyOn(ProofChamberInstance.prototype, 'set_param_by_id');
        try {
            const scheduled = await render('damping', fixture, segments, 'by-id', spy);
            const held = await render('damping', fixture, segments, 'static', spy);
            expect(scheduled.calls).toEqual(expectedCalls(segments, 2));
            expect(scheduled.calls[0]).toEqual([256, 2, 0.2]);
            expect(scheduled.pcm.slice(0, 256 * 2)).toEqual(held.pcm.slice(0, 256 * 2));
        } finally {
            spy.mockRestore();
            vi.stubGlobal('currentFrame', 0);
        }
    }, 30_000);

    it('binds every descriptor control to the real compiled schedule, worklet call, and audible named target', async () => {
        const names = Object.keys(PROOF_CHAMBER_AUTOMATION_PARAM_IDS).filter(
            (name) => name !== 'mix' && name !== 'decay'
        );
        expect(names.sort()).toEqual(Object.keys(FIXTURES).sort());
        const spy = vi.spyOn(ProofChamberInstance.prototype, 'set_param_by_id');
        try {
            for (const name of names) {
                const fixture = FIXTURES[name]!;
                expect(fixture.why).not.toBe('');
                const movingSegments = schedule(name, fixture, true);
                const staticSegments = schedule(name, fixture, false);
                const ordinal = PROOF_CHAMBER_AUTOMATION_PARAM_IDS[name]!;
                const moving = await render(name, fixture, movingSegments, 'by-id', spy);
                const flat = await render(name, fixture, staticSegments, 'by-id', spy);
                const named = await render(name, fixture, movingSegments, 'by-name', spy);

                expect(moving.calls).toEqual(expectedCalls(movingSegments, ordinal));
                expect(flat.calls).toEqual(expectedCalls(staticSegments, ordinal));
                expect(moving.calls).not.toEqual(flat.calls);
                if (name === 'freeze' || name === 'shimmer') {
                    expect(moving.calls.every(([, , value]) => value === 0 || value === 1)).toBe(true);
                    expect(new Set(moving.calls.map(([, , value]) => value))).toEqual(new Set([0, 1]));
                }
                expect(moving.pcm.every(Number.isFinite)).toBe(true);
                expect(moving.pcm.some((value) => Math.abs(value) > 1e-7)).toBe(true);
                expect(moving.pcm).not.toEqual(flat.pcm);
                expect(moving.pcm).toEqual(named.pcm);
            }
        } finally {
            spy.mockRestore();
            vi.stubGlobal('currentFrame', 0);
        }
    }, 180_000);
});
