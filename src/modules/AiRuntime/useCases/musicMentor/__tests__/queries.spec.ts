import { describe, it, expect, vi } from 'vitest';

import { getMentorTip } from '../queries';

import type { MentorLesson } from '../../../models/MusicMentorTypes';

const mocks = vi.hoisted(() => ({
    generateMentorLessons: vi.fn<() => MentorLesson[]>(),
}));

vi.mock('../generateLessons', () => ({
    generateMentorLessons: mocks.generateMentorLessons,
}));

function makeLesson(overrides: Partial<MentorLesson> = {}): MentorLesson {
    return {
        id: 'l1',
        category: 'general',
        title: 'Tip 1',
        observation: 'Too muddy',
        explanation: 'Low-mid buildup masks the mix.',
        advice: 'Do this.',
        level: 'beginner',
        relevance: 0.9,
        relatedConcepts: [],
        ...overrides,
    };
}

describe('musicMentor queries', () => {
    describe('getMentorTip', () => {
        it('returns the first lesson if any are generated', () => {
            const lesson = makeLesson();
            mocks.generateMentorLessons.mockReturnValue([lesson, makeLesson({ id: 'l2' })]);

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
