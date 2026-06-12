import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGetMentorTips } from '../handleGetMentorTips';

const mocks = vi.hoisted(() => ({
    generateMentorLessons: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/musicMentor/generateLessons', () => ({
    generateMentorLessons: mocks.generateMentorLessons,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleGetMentorTips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch lessons and display the first one', () => {
        mocks.generateMentorLessons.mockReturnValue([
            { title: 'EQ', observation: 'Too muddy', advice: 'Cut lows' },
            { title: 'Comp', observation: 'Too dynamic', advice: 'Squash it' },
        ]);

        void handleGetMentorTips.execute({ type: 'getMentorTips', payload: {} });

        expect(mocks.generateMentorLessons).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('🎓 EQ: Too muddy — Cut lows');
    });

    it('should notify success if there are no tips', () => {
        mocks.generateMentorLessons.mockReturnValue([]);

        void handleGetMentorTips.execute({ type: 'getMentorTips', payload: {} });

        expect(mocks.notifyUser).toHaveBeenCalledWith('No mentor tips at this time — looking good!', 'success');
    });

    it('should provide a description', () => {
        const description = handleGetMentorTips.describe({ type: 'getMentorTips', payload: {} });

        expect(description.label).toBe('Get Mentor Tips');
    });

    it('should not be undoable', () => {
        expect(handleGetMentorTips.undoable).toBe(false);
    });
});
