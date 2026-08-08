import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyParams } from '../applyParams';

/**
 * applyParams is a pure dispatch table: it routes (deviceType, params) to the
 * correct per-device applier, and silently ignores unknown types. The spec
 * mocks every applier so it can assert which one was called for each key — the
 * dispatch contract is the only logic this file owns.
 */
const mockAppliers = vi.hoisted(() => {
    function mk() {
        return vi.fn();
    }
    return {
        eq: mk(),
        compressor: mk(),
        sidechainCompressor: mk(),
        limiter: mk(),
        reverb: mk(),
        delay: mk(),
        convolutionReverb: mk(),
        gain: mk(),
        filter: mk(),
        distortion: mk(),
        bitcrusher: mk(),
        deesser: mk(),
        chorus: mk(),
        phaser: mk(),
        flanger: mk(),
        tremolo: mk(),
        autoPan: mk(),
        stereoWidener: mk(),
    };
});

vi.mock('../devices/dynamics/applyEqParams', () => ({ applyEqParams: mockAppliers.eq }));
vi.mock('../devices/dynamics/applyCompressorParams', () => ({ applyCompressorParams: mockAppliers.compressor }));
vi.mock('../devices/dynamics/applySidechainCompressorParams', () => ({
    applySidechainCompressorParams: mockAppliers.sidechainCompressor,
}));
vi.mock('../devices/dynamics/applyLimiterParams', () => ({ applyLimiterParams: mockAppliers.limiter }));
vi.mock('../devices/reverbDelay/applyReverbParams', () => ({ applyReverbParams: mockAppliers.reverb }));
vi.mock('../devices/reverbDelay/applyDelayParams', () => ({ applyDelayParams: mockAppliers.delay }));
vi.mock('../devices/reverbDelay/applyConvolutionReverbParams', () => ({
    applyConvolutionReverbParams: mockAppliers.convolutionReverb,
}));
vi.mock('../devices/toneShaping/applyGainParams', () => ({ applyGainParams: mockAppliers.gain }));
vi.mock('../devices/toneShaping/applyFilterParams', () => ({ applyFilterParams: mockAppliers.filter }));
vi.mock('../devices/toneShaping/applyDistortionParams', () => ({ applyDistortionParams: mockAppliers.distortion }));
vi.mock('../devices/toneShaping/applyBitcrusherParams', () => ({ applyBitcrusherParams: mockAppliers.bitcrusher }));
vi.mock('../devices/toneShaping/applyDeEsserParams', () => ({ applyDeEsserParams: mockAppliers.deesser }));
vi.mock('../devices/modulation/applyChorusParams', () => ({ applyChorusParams: mockAppliers.chorus }));
vi.mock('../devices/modulation/applyPhaserParams', () => ({ applyPhaserParams: mockAppliers.phaser }));
vi.mock('../devices/modulation/applyFlangerParams', () => ({ applyFlangerParams: mockAppliers.flanger }));
vi.mock('../devices/modulation/applyTremoloParams', () => ({ applyTremoloParams: mockAppliers.tremolo }));
vi.mock('../devices/modulation/applyAutoPanParams', () => ({ applyAutoPanParams: mockAppliers.autoPan }));
vi.mock('../devices/modulation/applyStereoWidenerParams', () => ({
    applyStereoWidenerParams: mockAppliers.stereoWidener,
}));

const DEVICE_TYPE_TO_MOCK: Record<string, (typeof mockAppliers)[keyof typeof mockAppliers]> = {
    'builtin-eq': mockAppliers.eq,
    'builtin-compressor': mockAppliers.compressor,
    'builtin-sidechain-compressor': mockAppliers.sidechainCompressor,
    'builtin-limiter': mockAppliers.limiter,
    'builtin-reverb': mockAppliers.reverb,
    'builtin-delay': mockAppliers.delay,
    'builtin-convolution-reverb': mockAppliers.convolutionReverb,
    'builtin-gain': mockAppliers.gain,
    'builtin-filter': mockAppliers.filter,
    'builtin-distortion': mockAppliers.distortion,
    'builtin-bitcrusher': mockAppliers.bitcrusher,
    'builtin-deesser': mockAppliers.deesser,
    'builtin-chorus': mockAppliers.chorus,
    'builtin-phaser': mockAppliers.phaser,
    'builtin-flanger': mockAppliers.flanger,
    'builtin-tremolo': mockAppliers.tremolo,
    'builtin-autopan': mockAppliers.autoPan,
    'builtin-stereo-widener': mockAppliers.stereoWidener,
};

describe('applyParams dispatch', () => {
    beforeEach(() => {
        for (const mockFn of Object.values(mockAppliers)) {
            mockFn.mockClear();
        }
    });

    it('routes each known device type to its applier with (dn, params)', () => {
        const dn = { id: 'node-stub' };
        const params = { freq: 1000 };

        for (const [deviceType, mockFn] of Object.entries(DEVICE_TYPE_TO_MOCK)) {
            applyParams(dn as never, deviceType, params);
            expect(mockFn).toHaveBeenCalledWith(dn, params);
        }

        // Every known type called exactly once.
        for (const mockFn of Object.values(DEVICE_TYPE_TO_MOCK)) {
            expect(mockFn).toHaveBeenCalledTimes(1);
        }
    });

    it('is a silent no-op for an unknown device type', () => {
        const dn = { id: 'node-stub' };

        // Should not throw and should not call any applier.
        expect(() => applyParams(dn as never, 'builtin-unknown-fx', { x: 1 })).not.toThrow();

        for (const mockFn of Object.values(DEVICE_TYPE_TO_MOCK)) {
            expect(mockFn).not.toHaveBeenCalled();
        }
    });

    it('is a silent no-op for builtin-lufs-meter (intentionally omitted pass-through)', () => {
        const dn = { id: 'node-stub' };

        // The LUFS meter is a pass-through analyser — it has no audio params to
        // apply, so it is deliberately absent from the dispatch table.
        expect(() => applyParams(dn as never, 'builtin-lufs-meter', { x: 1 })).not.toThrow();

        for (const mockFn of Object.values(DEVICE_TYPE_TO_MOCK)) {
            expect(mockFn).not.toHaveBeenCalled();
        }
    });
});
