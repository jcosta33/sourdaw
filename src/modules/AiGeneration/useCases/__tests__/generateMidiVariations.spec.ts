import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamCloudChatCompletionMock } = vi.hoisted(() => ({
    streamCloudChatCompletionMock: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: vi.fn<(...args: unknown[]) => unknown>().mockReturnValue(null),
    createAlternativeClips: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    streamCloudChatCompletion: streamCloudChatCompletionMock,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: vi.fn<(...args: unknown[]) => unknown>(),
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
