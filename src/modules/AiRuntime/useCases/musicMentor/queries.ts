import { type MentorLesson } from '#/modules/AiRuntime/models/MusicMentorTypes';
import { generateMentorLessons } from './generateLessons';

/**
 * Get a single mentor tip based on the most relevant observation.
 */
export function getMentorTip(): MentorLesson | null {
    const lessons = generateMentorLessons();
    return lessons.length > 0 ? lessons[0]! : null;
}
