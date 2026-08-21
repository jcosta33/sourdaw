import { describe, expect, it } from 'vitest';

import { type DdspSettings } from '../../models/InferenceRequest';
import {
    conditionDdspInput,
    createDdspInferenceChunks,
    finalizeDdspAudio,
    joinDdspChunkAudio,
} from '../ddspRenderPipeline';

const VIOLIN: DdspSettings = {
    averageMaxLoudness: -48.6,
    loudnessThreshold: -100,
    meanLoudness: -68.5,
    meanPitch: 62,
    modelMaxFrameLength: 1250,
    postGain: 2,
};
const FLUTE: DdspSettings = {
    averageMaxLoudness: -45.9,
    loudnessThreshold: -100,
    meanLoudness: -70.6,
    meanPitch: 63.2,
    modelMaxFrameLength: 1250,
    postGain: 4,
};

function midiToHz(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
}

describe('ddspRenderPipeline', () => {
    it.each([
        ['violin', VIOLIN, 50, 62],
        ['flute', FLUTE, 75, 63],
    ])(
        'conditions %s pitch to the checkpoint register by whole octaves',
        (_name, settings, inputMidi, expectedMidi) => {
            const inputPitch = midiToHz(inputMidi);
            const conditioned = conditionDdspInput({
                pitchHz: Float32Array.from([0, inputPitch, inputPitch]),
                loudnessDb: Float32Array.from([-120, -24, -30]),
                settings,
            });

            expect(conditioned.f0Hz[0]).toBe(0);
            expect(conditioned.loudnessDb[0]).toBe(-120);
            expect(conditioned.f0Hz[1]).toBeCloseTo(midiToHz(expectedMidi), 3);
            expect(Math.max(...conditioned.loudnessDb.subarray(1))).toBeLessThanOrEqual(settings.averageMaxLoudness);
            expect(conditioned.loudnessDb[1]).not.toBe(-24);
        }
    );

    it('pads fixed-shape chunks with checkpoint silence and overlaps one second', () => {
        const chunks = createDdspInferenceChunks({
            f0Hz: Float32Array.from({ length: 12 }, (_, index) => index + 1),
            loudnessDb: Float32Array.from({ length: 12 }, (_, index) => -60 + index),
            frameRate: 4,
            modelFrameLength: 8,
        });

        expect(chunks).toHaveLength(2);
        expect(Array.from(chunks[0]!.f0Hz)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(Array.from(chunks[1]!.f0Hz)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);

        const padded = createDdspInferenceChunks({
            f0Hz: Float32Array.from([220, 0]),
            loudnessDb: Float32Array.from([-60, -120]),
            frameRate: 4,
            modelFrameLength: 8,
        });
        expect(Array.from(padded[0]!.f0Hz)).toEqual([220, 0, -1, -1, -1, -1, -1, -1]);
        expect(Array.from(padded[0]!.loudnessDb)).toEqual([-60, -120, -120, -120, -120, -120, -120, -120]);
    });

    it('linearly crossfades model chunks without changing the timeline length', () => {
        const joined = joinDdspChunkAudio(
            [Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1]), Float32Array.from([0, 0, 0, 0, 2, 2, 2, 2])],
            4
        );

        expect(Array.from(joined)).toEqual([1, 1, 1, 1, 1, 0.75, 0.5, 0.25, 2, 2, 2, 2]);
    });

    it('applies postGain, sanitizes non-finite samples, limits only clipping, and fits exact length', () => {
        const final = finalizeDdspAudio({
            audio: Float32Array.from([0.2, 0.6, Number.NaN, Number.POSITIVE_INFINITY]),
            postGain: 2,
            targetSamples: 6,
        });

        expect(Array.from(final)).toEqual([0.4000000059604645, 1, 0, 0, 0, 0]);
    });
});
