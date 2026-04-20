import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamCloudChatCompletionMock } = vi.hoisted(() => ({
    streamCloudChatCompletionMock: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTrackStoreState: vi.fn().mockReturnValue(null),
    createAlternativeClips: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    streamCloudChatCompletion: streamCloudChatCompletionMock,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getNotesForClip: vi.fn(),
}));

import { generateMidiVariations } from '../generateMidiVariations';

describe('generateMidiVariations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when track state is unavailable', async () => {
        await expect(generateMidiVariations('clip-1')).rejects.toThrow(/Track state unavailable/);
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });
});
