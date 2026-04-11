import { describe, it, expect, vi } from 'vitest';
import { stopAutomationRecording } from '../stopAutomationRecording';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getAllTracks: vi.fn().mockReturnValue([]),
    }
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getAllTracks: mocks.getAllTracks,
    };
});

describe('stopAutomationRecording', () => {
    it('resolves track list via injected getAllTracks', () => {
        stopAutomationRecording();

        expect(mocks.getAllTracks).toHaveBeenCalled();
    });
});
