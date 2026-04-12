import { describe, it, expect, vi } from 'vitest';
import { getMentorTip } from '../queries';

const mocks = vi.hoisted(() => ({
    generateMentorLessons: vi.fn(),
}));

vi.mock('../generateLessons', () => ({
    generateMentorLessons: mocks.generateMentorLessons,
}));

describe('musicMentor queries', () => {
    describe('getMentorTip', () => {
        it('returns the first lesson if any are generated', () => {
            const lesson = { id: 'l1', title: 'Tip 1', content: 'Do this.' } as any;
            mocks.generateMentorLessons.mockReturnValue([lesson, { id: 'l2' }]);
            
            const tip = getMentorTip();
            expect(tip).toBe(lesson);
        });

        it('returns null if no lessons are generated', () => {
            mocks.generateMentorLessons.mockReturnValue([]);
            
            const tip = getMentorTip();
            expect(tip).toBeNull();
        });
    });
});
