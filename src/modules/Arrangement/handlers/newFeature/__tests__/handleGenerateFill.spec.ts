import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGenerateFill } from '../handleGenerateFill';

const mocks = vi.hoisted(() => ({
    generateDrumFill: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/fillTransitionGeneration/generation', () => ({
    generateDrumFill: mocks.generateDrumFill,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleGenerateFill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes generateDrumFill with provided parameters and notifies success', () => {
        mocks.generateDrumFill.mockReturnValue({ notes: [1, 2, 3] });

        handleGenerateFill.execute({
            type: 'generateFill',
            payload: { atBeat: 16, durationBeats: 4, style: 'syncopated' },
        });

        expect(mocks.generateDrumFill).toHaveBeenCalledWith(16, 4, 'syncopated');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Generated 3-note drum fill', 'success');
    });

    it('uses defaults for duration and style', () => {
        mocks.generateDrumFill.mockReturnValue({ notes: [] });

        handleGenerateFill.execute({
            type: 'generateFill',
            payload: { atBeat: 32 },
        });

        expect(mocks.generateDrumFill).toHaveBeenCalledWith(32, 2, 'descending');
    });

    it('provides a description', () => {
        const desc = handleGenerateFill.describe({ type: 'generateFill', payload: { atBeat: 0 } });
        expect(desc.label).toBe('Generate Fill');
    });

    it('is undoable', () => {
        expect(handleGenerateFill.undoable).toBe(true);
    });
});
