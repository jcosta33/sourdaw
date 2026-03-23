import { type MentorCategory, type MentorLesson } from './types';
import { generateMentorLessons } from './generateLessons';

/**
 * Get a single mentor tip based on the most relevant observation.
 */
export function getMentorTip(): MentorLesson | null {
    const lessons = generateMentorLessons();
    return lessons.length > 0 ? lessons[0]! : null;
}

/**
 * Get lessons filtered by category.
 */
export function getLessonsByCategory(category: MentorCategory): MentorLesson[] {
    return generateMentorLessons().filter((l) => l.category === category);
}

/**
 * Get lessons filtered by skill level.
 */
export function getLessonsByLevel(level: MentorLesson['level']): MentorLesson[] {
    return generateMentorLessons().filter((l) => l.level === level);
}
