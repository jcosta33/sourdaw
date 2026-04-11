import { describe, it, expect, vi } from 'vitest';
import { startAutomationRecording } from '../startAutomationRecording';

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

describe('startAutomationRecording', () => {
    it('does not throw when automation store is empty', () => {
        expect(() => {
            startAutomationRecording();
        }).not.toThrow();

        expect(mocks.getAllTracks).toHaveBeenCalled();
    });
});
