import { describe, expect, it, vi } from 'vitest';

import { type GrinderFactoryPresetAction } from '../../../events/grinderAppActions';
import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { buildRectifierHeavyPlayback } from '../buildRectifierHeavyPlayback';
import { encodeGrinderPatchCommands } from '../encodeGrinderPatchCommands';
import { getRectifierHeavyPresetImage } from '../getRectifierHeavyPresetImage';

const target = {
    trackId: 'track',
    deviceId: 'grinder',
    deviceIds: ['grinder', 'sentinel'],
    ownerIncarnation: { trackObjectId: 'track-object', deviceObjectId: 'device-object' },
};

function rectifierAction(
    before: Record<string, number>,
    direction?: 'undo'
): GrinderFactoryPresetAction['payload'] & { after: Readonly<Record<string, number>> } {
    const factory = getRectifierHeavyPresetImage();
    if (!factory) {
        throw new Error('Rectifier Heavy is missing');
    }
    const after = factory.parameterValues;
    return {
        ...target,
        presetId: 'gr-rectifier-heavy',
        before: Object.fromEntries(Object.keys(after).map((key) => [key, before[key] ?? null])),
        after,
        direction,
    };
}

describe('Rectifier Heavy live playback', () => {
    it('sends only the emitted footprint and keeps an active overlay separate from the authored gain', () => {
        const payload = rectifierAction({});
        const readEffective = vi.fn((_trackId: string, _deviceId: string, key: string) =>
            key === 'gain' ? 3.4 : undefined
        );
        const playback = buildRectifierHeavyPlayback(payload, payload.after, readEffective);

        expect(
            Object.fromEntries(playback.web.parameters.map(({ parameterId, value }) => [parameterId, value]))
        ).toEqual(payload.after);
        expect(playback.web.neural).toEqual({ neuralModelMode: 'builtin' });
        expect(playback.web.overrides).toEqual([{ parameterId: 'gain', value: 3.4 }]);
        expect(playback.native.values.gain).toBe(3.4);
        expect(playback.native.resetParameterIds).toEqual([]);
        expect(readEffective).toHaveBeenCalledWith('track', 'grinder', 'gain');
        expect(readEffective).not.toHaveBeenCalledWith('track', 'sentinel', expect.any(String));
    });

    it('restores absent DSP constructor settings and leaves present settings or active controls explicit', () => {
        const before = { gain: 5, gateAttack: 2, ampModel: 3, cabIrSlot: 1, routingMode: 2, neuralModelSlot: 2 };
        const replay = buildRectifierHeavyPlayback(rectifierAction(before, 'undo'), before, (_, __, key) =>
            key === 'gateRelease' ? 80 : undefined
        );

        expect(replay.web.parameters).toEqual(
            expect.arrayContaining([
                { parameterId: 'gain', value: 5 },
                { parameterId: 'ampModel', value: 3 },
                { parameterId: 'cabIrSlot', value: 1 },
                { parameterId: 'routingMode', value: 2 },
                { parameterId: 'mic2PositionY', value: 0.3 },
                { parameterId: 'mic2Distance', value: 0.5 },
                { parameterId: 'preOverdriveTone', value: 5.5 },
                { parameterId: 'postCompressorThreshold', value: -20 },
                { parameterId: 'transformerDrive', value: 0.3 },
            ])
        );
        expect(replay.web.resetParameterIds).toEqual([
            'couplingCapCharge',
            'transformerHysteresis',
            'transformerLfSaturation',
        ]);
        expect(replay.native.resetParameterIds).toEqual([
            'couplingCapCharge',
            'transformerDrive',
            'transformerHysteresis',
            'transformerLfSaturation',
        ]);
        expect(replay.native.values).toMatchObject({ gateAttack: 2, gateRelease: 80, neuralModelSlot: 2 });
        expect(replay.native.values).not.toHaveProperty('transformerDrive');
        expect(Object.keys(replay.native.values).at(-1)).toBe('neuralModelSlot');
    });

    it('restores the imported scalar profile in native order without sending digest metadata as DSP controls', () => {
        const imported = encodeGrinderPatchCommands({
            ...DEFAULT_PATCH,
            neuralModelSource: 'imported',
            neuralModelProfile: {
                derivedFrom: 'nam',
                sourceArchitecture: 'lstm',
                sourceSampleRate: 48_000,
                sourceWeightCount: 0,
                preferredTier: 'lite',
                inputDrive: 1.2,
                asymmetry: 0.1,
                outputTrim: 0.9,
                contourMix: 0.3,
                recurrentBias: 0.05,
                convWeights: Array.from({ length: 10 }, () => [0.1, 0.2, 0.3]),
                model: null,
                modelDigest: null,
            },
        });
        const before = Object.fromEntries(
            imported.flatMap((entry) => (entry.kind === 'parameter' ? [[entry.key, entry.value]] : []))
        );
        const replay = buildRectifierHeavyPlayback(rectifierAction(before, 'undo'), before, () => undefined);
        const nativeKeys = Object.keys(replay.native.values);

        expect(replay.web.neural).toMatchObject({ neuralModelMode: 'imported' });
        expect(replay.native.modelJson).toBeNull();
        expect(replay.native.values).toMatchObject({
            neuralModelMode: 1,
            neuralCustomInputDrive: 1.2,
            neuralCustomConvWeight9_2: 0.3,
        });
        expect(nativeKeys[0]).toBe('neuralEnabled');
        expect(nativeKeys.indexOf('neuralTier')).toBeLessThan(nativeKeys.indexOf('neuralCustomTier'));
        expect(nativeKeys.at(-1)).toBe('neuralModelMode');
        expect(nativeKeys.some((key) => key.startsWith('neuralCustomModelDigest'))).toBe(false);
    });
});
