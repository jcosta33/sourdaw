import { describe, it, expect, vi } from 'vitest';

import { getMentorTip } from '../queries';

import type { MentorLesson } from '#/modules/AiRuntime/useCases/musicMentor/generateLessons';

const mocks = vi.hoisted(() => ({
    generateMentorLessons: vi.fn<() => MentorLesson[]>(),
}));

vi.mock('../generateLessons', () => ({
    generateMentorLessons: mocks.generateMentorLessons,
}));

describe('musicMentor queries', () => {
    describe('getMentorTip', () => {
        it('returns the first lesson if any are generated', () => {
            const lesson = { id: 'l1', title: 'Tip 1', content: 'Do this.' } as unknown as MentorLesson;
            mocks.generateMentorLessons.mockReturnValue([lesson, { id: 'l2' } as unknown as MentorLesson]);

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
