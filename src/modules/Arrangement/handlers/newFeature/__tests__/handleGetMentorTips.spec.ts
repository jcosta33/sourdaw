import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGetMentorTips } from '../handleGetMentorTips';

const mocks = vi.hoisted(() => ({
    generateMentorLessons: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    generateMentorLessons: mocks.generateMentorLessons,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleGetMentorTips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches lessons and displays the first one', () => {
        mocks.generateMentorLessons.mockReturnValue([
            { title: 'EQ', observation: 'Too muddy', advice: 'Cut lows' },
            { title: 'Comp', observation: 'Too dynamic', advice: 'Squash it' },
        ]);

        handleGetMentorTips.execute({ type: 'getMentorTips', payload: {} });

        expect(mocks.generateMentorLessons).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('🎓 EQ: Too muddy — Cut lows');
    });

    it('notifies success if there are no tips', () => {
        mocks.generateMentorLessons.mockReturnValue([]);

        handleGetMentorTips.execute({ type: 'getMentorTips', payload: {} });

        expect(mocks.notifyUser).toHaveBeenCalledWith('No mentor tips at this time — looking good!', 'success');
    });

    it('provides a description', () => {
        const desc = handleGetMentorTips.describe({ type: 'getMentorTips', payload: {} });
        expect(desc.label).toBe('Get Mentor Tips');
    });

    it('is not undoable', () => {
        expect(handleGetMentorTips.undoable).toBe(false);
    });
});
