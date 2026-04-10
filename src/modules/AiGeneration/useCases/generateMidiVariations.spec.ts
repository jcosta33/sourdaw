import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateMidiVariations } from './generateMidiVariations';

describe('generateMidiVariations', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns early when track state is unavailable', async () => {
        const streamCloudChatCompletion = vi.fn();
        injectDependencies(generateMidiVariations, {
            getTrackState: vi.fn().mockReturnValue(null),
            streamCloudChatCompletion,
            getNotesForClip: vi.fn(),
            createAlternativeClips: vi.fn(),
        });

        await generateMidiVariations('clip-1');

        expect(streamCloudChatCompletion).not.toHaveBeenCalled();
    });
});
