export type MentorCategory =
    | 'frequency-balance'
    | 'dynamics'
    | 'stereo-field'
    | 'gain-staging'
    | 'arrangement'
    | 'effects'
    | 'general';

export type MentorLesson = {
    id: string;
    category: MentorCategory;
    title: string;
    /** What the mentor observed in the project */
    observation: string;
    /** Why this matters musically */
    explanation: string;
    /** Specific actionable advice */
    advice: string;
    /** Difficulty level */
    level: 'beginner' | 'intermediate' | 'advanced';
    /** Confidence that this lesson is relevant (0–1) */
    relevance: number;
    /** Related concepts for further learning */
    relatedConcepts: string[];
};
