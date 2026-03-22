/**
 * AI Music Mentor Mode
 *
 * Explainable AI that analyzes mix decisions and provides educational
 * feedback explaining WHY certain mixing techniques work. Teaches users
 * music production concepts through contextual analysis of their project.
 */

import { trackStore } from '#/modules/Track/stores/trackStore';
import { analyzeMix } from './referenceMixComparison';

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

let lessonCounter = 0;

function createLesson(
    category: MentorCategory,
    title: string,
    observation: string,
    explanation: string,
    advice: string,
    level: MentorLesson['level'],
    relevance: number,
    relatedConcepts: string[]
): MentorLesson {
    return {
        id: `lesson-${++lessonCounter}`,
        category,
        title,
        observation,
        explanation,
        advice,
        level,
        relevance,
        relatedConcepts,
    };
}

/**
 * Analyze the current project and generate contextual lessons.
 */
export function generateMentorLessons(): MentorLesson[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const analysis = analyzeMix();
    const tracks = state.tracks;
    const lessons: MentorLesson[] = [];

    // ── Gain Staging ────────────────────────────────────────
    const gains = tracks.filter((t) => t.kind !== 'folder').map((t) => t.gain ?? 0);
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
    const maxGain = gains.length > 0 ? Math.max(...gains) : 0;

    if (maxGain > 0) {
        lessons.push(createLesson(
            'gain-staging',
            'Hot Signal Levels',
            `Track "${tracks.find((t) => t.gain === maxGain)?.name}" has gain at +${maxGain.toFixed(1)} dB.`,
            'Positive gain at the track level reduces your headroom and can cause digital clipping at the master bus. Professional mixes typically keep individual tracks well below 0 dBFS to leave room for the sum of all tracks.',
            'Try reducing all track faders by 6–12 dB and adjusting the master bus to compensate. This gives you much more control over the final mix.',
            'beginner',
            0.9,
            ['headroom', 'gain staging', 'digital clipping', 'unity gain']
        ));
    }

    if (avgGain < -20) {
        lessons.push(createLesson(
            'gain-staging',
            'Very Low Track Levels',
            `Average track gain is ${avgGain.toFixed(1)} dB, which is quite low.`,
            'While low levels prevent clipping, signals that are too quiet can result in a poor signal-to-noise ratio. The mix may sound thin and lack impact compared to professional releases.',
            'Aim for track peaks around -12 to -6 dBFS at the fader. This balances headroom with signal quality.',
            'beginner',
            0.75,
            ['signal-to-noise ratio', 'gain staging', 'metering']
        ));
    }

    // ── Panning / Stereo Field ──────────────────────────────
    const pans = tracks.filter((t) => t.kind !== 'folder' && !t.muted).map((t) => t.pan ?? 0);
    const centerTracks = pans.filter((p) => Math.abs(p) < 0.1).length;
    const totalActive = pans.length || 1;

    if (centerTracks / totalActive > 0.7 && totalActive > 3) {
        lessons.push(createLesson(
            'stereo-field',
            'Narrow Stereo Image',
            `${centerTracks} out of ${totalActive} tracks are panned near center.`,
            'When too many elements occupy the center of the stereo field, they compete for the same space and can mask each other. Professional mixes strategically spread instruments across the stereo panorama to create width and clarity.',
            'Keep bass and vocals centered, but pan guitars, keyboards, and background elements to create space. Hard-pan doubles left and right for maximum width.',
            'intermediate',
            0.85,
            ['stereo width', 'panning', 'Haas effect', 'mono compatibility', 'frequency masking']
        ));
    }

    // ── Track Count / Arrangement ───────────────────────────
    const trackCount = tracks.filter((t) => t.kind !== 'folder').length;

    if (trackCount > 30) {
        lessons.push(createLesson(
            'arrangement',
            'Dense Arrangement',
            `Your project has ${trackCount} tracks, which is a relatively dense arrangement.`,
            'More tracks means more potential for frequency conflicts and a "muddy" mix. Great producers sometimes achieve impact with fewer, well-chosen elements rather than stacking more layers.',
            'Consider muting tracks to hear if any can be removed without losing the musical intent. Focus on contrast — having sections with fewer elements makes the full arrangement feel more powerful.',
            'intermediate',
            0.7,
            ['arrangement', 'less is more', 'frequency masking', 'subtractive mixing']
        ));
    }

    if (trackCount < 4 && trackCount > 0) {
        lessons.push(createLesson(
            'arrangement',
            'Minimal Arrangement',
            `Your project has only ${trackCount} tracks.`,
            'Minimalist arrangements can sound incredible when each element is carefully crafted, but they also expose every detail. Each instrument needs to be well-produced and well-mixed because there\'s nowhere to hide.',
            'Focus on making each track sound as polished as possible. Consider adding subtle effects like reverb sends, delays, and gentle compression to fill the space.',
            'beginner',
            0.6,
            ['arrangement', 'sound design', 'reverb', 'space']
        ));
    }

    // ── Solo/Mute Hygiene ───────────────────────────────────
    const soloedTracks = tracks.filter((t) => t.soloed).length;
    if (soloedTracks > 0) {
        lessons.push(createLesson(
            'general',
            'Solo Mode Active',
            `${soloedTracks} track(s) are currently soloed.`,
            'Mixing in solo mode is one of the most common beginner mistakes. A track that sounds great in solo may not sit well in the full mix because mixing is about context and relationships between instruments.',
            'Solo briefly to identify problems, but always make level and EQ decisions in the context of the full mix. Toggle solo on and off frequently to maintain perspective.',
            'beginner',
            0.95,
            ['solo mode', 'contextual mixing', 'critical listening']
        ));
    }

    // ── Frequency Balance ───────────────────────────────────
    if (analysis.frequencyProfile.bass > 0.8) {
        lessons.push(createLesson(
            'frequency-balance',
            'Heavy Low End',
            'The mix has substantial energy in the bass frequencies.',
            'Excessive low-end energy eats up headroom and can make the mix sound boomy and undefined on consumer speakers. Bass frequencies contain the most energy per octave, so small cuts here create big gains in clarity.',
            'Apply a gentle high-pass filter (30–80 Hz) to all non-bass instruments to clean up sub-rumble. Use a reference track to calibrate your bass levels.',
            'intermediate',
            0.8,
            ['high-pass filter', 'bass management', 'low-end clarity', 'headroom']
        ));
    }

    // ── Dynamics ─────────────────────────────────────────────
    if (analysis.dynamicRange < 5) {
        lessons.push(createLesson(
            'dynamics',
            'Limited Dynamic Range',
            `Dynamic range is approximately ${analysis.dynamicRange.toFixed(1)} dB, which is quite compressed.`,
            'Over-compression removes the natural "breathing" of music and leads to listener fatigue. The loudness war has shown that louder is not always better — streaming platforms normalize loudness anyway.',
            'Ease off compressors and limiters. Aim for -14 LUFS integrated loudness (Spotify/YouTube target). Let transients hit and allow the music to breathe.',
            'intermediate',
            0.85,
            ['loudness war', 'dynamic range', 'LUFS', 'compression', 'loudness normalization']
        ));
    }

    if (analysis.dynamicRange > 16) {
        lessons.push(createLesson(
            'dynamics',
            'Wide Dynamic Range',
            `Dynamic range is approximately ${analysis.dynamicRange.toFixed(1)} dB, which is quite wide.`,
            'While dynamics are musically important, too much variation can make quiet parts inaudible and loud parts jarring, especially in casual listening environments like car stereo or earbuds.',
            'Consider gentle bus compression (2–4 dB gain reduction, slow attack, auto release) to glue the mix together while preserving musicality.',
            'intermediate',
            0.7,
            ['bus compression', 'glue compression', 'mix bus', 'parallel compression']
        ));
    }

    // Sort by relevance
    return lessons.sort((a, b) => b.relevance - a.relevance);
}

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
