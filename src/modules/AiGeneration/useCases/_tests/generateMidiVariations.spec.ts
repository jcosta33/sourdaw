import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMidiVariations } from '../generateMidiVariations';

const { streamCloudChatCompletionMock } = vi.hoisted(() => ({
    streamCloudChatCompletionMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn().mockReturnValue(null),
    createAlternativeClips: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    streamCloudChatCompletion: streamCloudChatCompletionMock,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: vi.fn(),
}));

describe('generateMidiVariations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when track state is unavailable', async () => {
        await generateMidiVariations('clip-1');

        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });
});
