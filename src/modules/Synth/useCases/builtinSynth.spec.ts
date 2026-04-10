import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultSynthParams } from '#/modules/AudioEngine/useCases/audioEngineQueries';
import { getSynthParamsForTrack } from './builtinSynth';

describe('getSynthParamsForTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns default params when track is missing', () => {
        injectDependencies(getSynthParamsForTrack, {
            getTrackById: vi.fn(() => null),
        });
        const params = getSynthParamsForTrack('unknown-track');
        expect(params).toEqual(defaultSynthParams);
    });
});
