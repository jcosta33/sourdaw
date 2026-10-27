import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

import { DEFAULT_PATCH, type ProofPatch } from '../../models/ProofPatch';
import { hydrateProofPatch, proofStore } from '../../stores/proofStore';
import { syncFullPatch } from '../../useCases/proofParamBridge/syncFullPatch';
import { PROOF_PRESETS } from '../../useCases/proofPresets';
import { getProofPatchParameterValues } from '../getProofPatchParameterValues';

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: (deviceId: string) => ({
        status: 'eligible',
        trackId: 'track-registry',
        deviceId,
    }),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({ getTrackStoreState: () => null }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ updateDeviceParam: vi.fn(), updateDevicePatch: vi.fn() }));

function minimalPatch(overrides: Partial<ProofPatch> = {}): ProofPatch {
    return {
        name: 'test',
        chainOrder: [0, 1, 2, 3, 4],
        inputGain: 1.5,
        outputGain: -0.5,
        eqBypassed: false,
        eqBands: [
            { enabled: true, type: 0, channel: 0, freq: 1000, gain: 2, q: 0.7 },
            { enabled: false, type: 1, channel: 1, freq: 200, gain: -3, q: 1.2 },
        ],
        dynBypassed: false,
        dynCrossoverFreqs: [120, 800, 5000],
        dynBands: [
            {
                threshold: -20,
                ratio: 2,
                attack: 10,
                release: 100,
                knee: 6,
                makeup: 3,
                autoMakeup: true,
                bypassed: false,
            },
            {
                threshold: -30,
                ratio: 4,
                attack: 20,
                release: 200,
                knee: 9,
                makeup: 5,
                autoMakeup: false,
                bypassed: true,
            },
        ],
        imgBypassed: false,
        imgBandWidth: [1, 1.5, 0.5, 2],
        imgAutoMonoBass: true,
        imgMonoBassFreq: 80,
        excBypassed: false,
        excBands: [
            { type: 1, drive: 0.4, blend: 0.3, enabled: true },
            { type: 0, drive: 0.6, blend: 0.5, enabled: false },
        ],
        limBypassed: false,
        limCeiling: -1,
        limRelease: 50,
        limLookahead: 5,
        ditherMode: 'tpdf',
        ditherBits: 16,
        target: 'streaming',
        targetLufs: -14,
        ...overrides,
    };
}

describe('getProofPatchParameterValues', () => {
    it('maps scalar input/output gains and limiter params', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        expect(values.input_gain).toBe(1.5);
        expect(values.output_gain).toBe(-0.5);
        expect(values.lim_ceiling).toBe(-1);
        expect(values.lim_release).toBe(50);
        expect(values.lim_lookahead).toBe(5);
        expect(values.target_lufs).toBe(-14);
    });

    it('encodes boolean bypass flags as 1/0', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        expect(values.eq_bypass).toBe(0);
        expect(values.dyn_bypass).toBe(0);
        expect(values.img_bypass).toBe(0);
        expect(values.exc_bypass).toBe(0);
        expect(values.lim_bypass).toBe(0);
        // imgAutoMonoBass is a non-bypass boolean→1/0 mapping.
        expect(values.img_auto_mono_bass).toBe(1);
        expect(values.img_mono_bass_freq).toBe(80);
    });

    it('encodes true bypass flags as 1', () => {
        const values = getProofPatchParameterValues(
            minimalPatch({
                eqBypassed: true,
                dynBypassed: true,
                imgBypassed: true,
                excBypassed: true,
                limBypassed: true,
            })
        );
        expect(values.eq_bypass).toBe(1);
        expect(values.dyn_bypass).toBe(1);
        expect(values.img_bypass).toBe(1);
        expect(values.exc_bypass).toBe(1);
        expect(values.lim_bypass).toBe(1);
    });

    it('encodes the dither mode and bits', () => {
        // off=0, tpdf=1, noise_shaped=2.
        expect(getProofPatchParameterValues(minimalPatch({ ditherMode: 'off' })).dither_mode).toBe(0);
        expect(getProofPatchParameterValues(minimalPatch({ ditherMode: 'tpdf' })).dither_mode).toBe(1);
        const values = getProofPatchParameterValues(minimalPatch({ ditherMode: 'noise_shaped', ditherBits: 24 }));
        expect(values.dither_mode).toBe(2);
        expect(values.dither_bits).toBe(24);
    });

    it('encodes the target mode as its index in the ProofTarget list', () => {
        // streaming=0, cd=1, club=2, broadcast=3, podcast=4, custom=5.
        expect(getProofPatchParameterValues(minimalPatch({ target: 'streaming' })).target_mode).toBe(0);
        expect(getProofPatchParameterValues(minimalPatch({ target: 'club' })).target_mode).toBe(2);
        expect(getProofPatchParameterValues(minimalPatch({ target: 'custom' })).target_mode).toBe(5);
    });

    it('expands EQ bands with indexed keys for every band', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        // Band 0.
        expect(values.eq_band0_freq).toBe(1000);
        expect(values.eq_band0_gain).toBe(2);
        expect(values.eq_band0_q).toBe(0.7);
        expect(values.eq_band0_type).toBe(0);
        expect(values.eq_band0_channel).toBe(0);
        expect(values.eq_band0_enabled).toBe(1);
        // Band 1 (second band — proves the loop indexes correctly).
        expect(values.eq_band1_freq).toBe(200);
        expect(values.eq_band1_gain).toBe(-3);
        expect(values.eq_band1_q).toBe(1.2);
        expect(values.eq_band1_type).toBe(1);
        expect(values.eq_band1_channel).toBe(1);
        expect(values.eq_band1_enabled).toBe(0);
    });

    it('expands dynamics crossover frequencies with indexed keys', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        expect(values.dyn_xover0).toBe(120);
        expect(values.dyn_xover1).toBe(800);
        expect(values.dyn_xover2).toBe(5000);
    });

    it('expands dynamics band params with indexed keys for every band', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        // Band 0 — all scalar fields, not just threshold/ratio.
        expect(values.dyn_band0_threshold).toBe(-20);
        expect(values.dyn_band0_ratio).toBe(2);
        expect(values.dyn_band0_attack).toBe(10);
        expect(values.dyn_band0_release).toBe(100);
        expect(values.dyn_band0_knee).toBe(6);
        expect(values.dyn_band0_makeup).toBe(3);
        expect(values.dyn_band0_auto_makeup).toBe(1);
        expect(values.dyn_band0_bypass).toBe(0);
        // Band 1.
        expect(values.dyn_band1_threshold).toBe(-30);
        expect(values.dyn_band1_ratio).toBe(4);
        expect(values.dyn_band1_attack).toBe(20);
        expect(values.dyn_band1_release).toBe(200);
        expect(values.dyn_band1_knee).toBe(9);
        expect(values.dyn_band1_makeup).toBe(5);
        expect(values.dyn_band1_auto_makeup).toBe(0);
        expect(values.dyn_band1_bypass).toBe(1);
    });

    it('expands imager band widths and exciter bands including blend', () => {
        const values = getProofPatchParameterValues(minimalPatch());
        expect(values.img_width0).toBe(1);
        expect(values.img_width1).toBe(1.5);
        expect(values.exc_band0_type).toBe(1);
        expect(values.exc_band0_drive).toBe(0.4);
        expect(values.exc_band0_blend).toBe(0.3);
        expect(values.exc_band0_enabled).toBe(1);
        // Second exciter band.
        expect(values.exc_band1_type).toBe(0);
        expect(values.exc_band1_drive).toBe(0.6);
        expect(values.exc_band1_blend).toBe(0.5);
        expect(values.exc_band1_enabled).toBe(0);
    });

    it('expands the chain order with positional keys', () => {
        const values = getProofPatchParameterValues(minimalPatch({ chainOrder: [4, 3, 2, 1, 0] }));
        expect(values.chain_order_0).toBe(4);
        expect(values.chain_order_4).toBe(0);
    });
});

describe('complete persisted Proof producer against the applied registry', () => {
    it.each([{ id: 'default', patch: DEFAULT_PATCH }, ...PROOF_PRESETS])(
        'real full-patch emitters cover the saved scalar and order targets for $id',
        ({ patch }) => {
            proofStore.set({});
            vi.mocked(updateDeviceParam).mockClear();
            vi.mocked(updateDevicePatch).mockClear();
            hydrateProofPatch({ deviceId: 'proof-registry', patch });
            syncFullPatch('proof-registry');
            const writes = vi.mocked(updateDeviceParam).mock.calls;
            const applied = Object.fromEntries(
                writes.map(([trackId, deviceId, name, value]) => {
                    expect(trackId).toBe('track-registry');
                    expect(deviceId).toBe('proof-registry');
                    return [name, value];
                })
            );
            const persisted = getProofPatchParameterValues(patch);
            const scalar = Object.fromEntries(
                Object.entries(persisted).filter(
                    ([name]) => !name.startsWith('chain_order_') && name !== 'target_mode' && name !== 'target_lufs'
                )
            );
            expect(applied).toEqual({ ...scalar, ab_bypass: 0 });
            expect(writes).toHaveLength(Object.keys(scalar).length + 1);
            expect(updateDevicePatch).toHaveBeenCalledExactlyOnceWith(
                'track-registry',
                'proof-registry',
                Object.fromEntries(patch.chainOrder.map((module, index) => [`chain_order_${index}`, module]))
            );
        }
    );

    it('classifies every default patch target exactly once, separately from metadata', () => {
        const contract: {
            version: number;
            parameters: Array<{ name: string; persisted: boolean; minimum: number; maximum: number; kind: string }>;
        } = JSON.parse(
            readFileSync(
                resolve(process.cwd(), 'src/modules/AudioEngine/services/proofAppliedParameterContract.json'),
                'utf8'
            )
        );
        expect(contract.version).toBe(1);
        const values = getProofPatchParameterValues(DEFAULT_PATCH);
        expect(Object.keys(values).length).toBeGreaterThan(100);
        for (const [name, value] of Object.entries(values)) {
            if (name === 'target_mode' || name === 'target_lufs') {
                expect(contract.parameters.some((p) => p.name === name)).toBe(false);
                continue;
            }
            const entries = contract.parameters.filter((p) => p.name === name);
            expect(entries, name).toHaveLength(1);
            const entry = entries[0]!;
            expect(entry.persisted, name).toBe(true);
            expect(value, name).toBeGreaterThanOrEqual(entry.minimum);
            expect(value, name).toBeLessThanOrEqual(entry.maximum);
            if (entry.kind !== 'continuous') {
                expect(Number.isInteger(value), name).toBe(true);
            }
        }
        expect(values.eq_band1_enabled).toBe(1);
        expect(values.exc_band0_drive).toBe(0.2);
        expect(values.ab_bypass).toBeUndefined();
    });
});
