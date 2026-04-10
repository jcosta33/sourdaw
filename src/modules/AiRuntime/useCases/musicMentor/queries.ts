import { generateMentorLessons } from './generateLessons';

type MentorLesson = ReturnType<typeof generateMentorLessons>[number];

/**
 * Get a single mentor tip based on the most relevant observation.
 */
export function getMentorTip(): MentorLesson | null {
    const lessons = generateMentorLessons();
    return lessons.length > 0 ? lessons[0]! : null;
}
