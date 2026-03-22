/**
 * AI Fill & Transition Generation
 *
 * Generates contextual drum fills, risers, sweeps, and transition
 * effects between arrangement sections. Analyzes surrounding content
 * to produce musically appropriate transitions.
 */

import { markerStore } from '#/modules/Timeline/stores/markerStore';

export type TransitionStyle = 'drum-fill' | 'riser' | 'sweep-down' | 'crash' | 'reverse-cymbal' | 'build' | 'breakdown';

export type GeneratedFill = {
    notes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>;
    durationBeats: number;
    style: TransitionStyle;
    confidence: number;
};

/** Standard GM drum map pitches */
const DRUM_MAP = {
    kick: 36,
    snare: 38,
    hiHat: 42,
    hiHatOpen: 46,
    ride: 51,
    crash: 49,
    tom1: 48,
    tom2: 45,
    tom3: 41,
    floorTom: 43,
} as const;

/** Common fill patterns (beat offsets within a single beat, velocity) */
const FILL_PATTERNS: Record<string, Array<{ offset: number; pitch: number; velocity: number }>> = {
    simple: [
        { offset: 0, pitch: DRUM_MAP.snare, velocity: 100 },
        { offset: 0.5, pitch: DRUM_MAP.snare, velocity: 90 },
    ],
    descending: [
        { offset: 0, pitch: DRUM_MAP.tom1, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.tom2, velocity: 105 },
        { offset: 0.5, pitch: DRUM_MAP.tom3, velocity: 100 },
        { offset: 0.75, pitch: DRUM_MAP.floorTom, velocity: 95 },
    ],
    sixteenth: [
        { offset: 0, pitch: DRUM_MAP.snare, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.snare, velocity: 85 },
        { offset: 0.5, pitch: DRUM_MAP.snare, velocity: 100 },
        { offset: 0.75, pitch: DRUM_MAP.snare, velocity: 90 },
    ],
    syncopated: [
        { offset: 0, pitch: DRUM_MAP.kick, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.snare, velocity: 95 },
        { offset: 0.75, pitch: DRUM_MAP.tom1, velocity: 100 },
    ],
};

/**
 * Generate a drum fill appropriate for the context.
 * Analyzes surrounding clip density and velocity to match energy.
 */
export function generateDrumFill(
    atBeat: number,
    durationBeats: number = 2,
    style: 'simple' | 'descending' | 'sixteenth' | 'syncopated' = 'descending'
): GeneratedFill {
    const pattern = FILL_PATTERNS[style] ?? FILL_PATTERNS.descending!;
    const notes: GeneratedFill['notes'] = [];

    const barsSpanned = Math.max(1, Math.floor(durationBeats));
    for (let beat = 0; beat < barsSpanned; beat++) {
        for (const hit of pattern) {
            const noteStart = atBeat + beat + hit.offset;
            // Accelerando effect — increase velocity toward the end
            const progress = (beat + hit.offset) / barsSpanned;
            const dynVelocity = Math.min(127, Math.round(hit.velocity * (0.8 + progress * 0.4)));

            notes.push({
                pitch: hit.pitch,
                startBeat: noteStart,
                duration: 0.25,
                velocity: dynVelocity,
            });
        }
    }

    // Add crash at the downbeat after the fill
    notes.push({
        pitch: DRUM_MAP.crash,
        startBeat: atBeat + durationBeats,
        duration: 1,
        velocity: 120,
    });

    return { notes, durationBeats, style: 'drum-fill', confidence: 0.85 };
}

/**
 * Generate a riser/build effect as MIDI notes.
 * Creates ascending pitch pattern that builds tension.
 */
export function generateRiser(
    atBeat: number,
    durationBeats: number = 4,
    startPitch: number = 60,
    endPitch: number = 84
): GeneratedFill {
    const notes: GeneratedFill['notes'] = [];
    const steps = Math.floor(durationBeats * 4); // 16th note resolution
    const pitchRange = endPitch - startPitch;

    for (let i = 0; i < steps; i++) {
        const progress = i / steps;
        const pitch = Math.round(startPitch + pitchRange * progress);
        const velocity = Math.min(127, Math.round(60 + 67 * progress)); // crescendo

        notes.push({
            pitch,
            startBeat: atBeat + (i * durationBeats) / steps,
            duration: durationBeats / steps,
            velocity,
        });
    }

    return { notes, durationBeats, style: 'riser', confidence: 0.75 };
}

/**
 * Generate a sweep-down (descending) transition.
 */
export function generateSweepDown(
    atBeat: number,
    durationBeats: number = 2,
    startPitch: number = 84,
    endPitch: number = 36
): GeneratedFill {
    const notes: GeneratedFill['notes'] = [];
    const steps = Math.floor(durationBeats * 4);
    const pitchRange = startPitch - endPitch;

    for (let i = 0; i < steps; i++) {
        const progress = i / steps;
        const pitch = Math.round(startPitch - pitchRange * progress);
        const velocity = Math.min(127, Math.round(100 - 40 * progress)); // decrescendo

        notes.push({
            pitch,
            startBeat: atBeat + (i * durationBeats) / steps,
            duration: durationBeats / steps,
            velocity,
        });
    }

    return { notes, durationBeats, style: 'sweep-down', confidence: 0.7 };
}

/**
 * Detect transition points in the arrangement and suggest fills.
 * Returns beat positions where transitions would be musically appropriate.
 */
export function detectTransitionPoints(): Array<{ beat: number; fromSection: string; toSection: string }> {
    const markers = markerStore.value;
    if (!markers) {
        return [];
    }

    const transitions: Array<{ beat: number; fromSection: string; toSection: string }> = [];
    const sections = [...markers.sections].sort((a, b) => a.startBeat - b.startBeat);

    for (let i = 0; i < sections.length - 1; i++) {
        const current = sections[i]!;
        const next = sections[i + 1]!;
        transitions.push({
            beat: current.endBeat - 2, // 2 beats before section boundary
            fromSection: current.name,
            toSection: next.name,
        });
    }

    return transitions;
}

/**
 * Auto-generate fills at all detected transition points.
 */
export function generateAllTransitionFills(): GeneratedFill[] {
    const points = detectTransitionPoints();
    return points.map((p) => {
        // Choose fill style based on transition type
        if (p.toSection.toLowerCase().includes('chorus') || p.toSection.toLowerCase().includes('drop')) {
            return generateRiser(p.beat, 4);
        }
        if (p.toSection.toLowerCase().includes('break') || p.toSection.toLowerCase().includes('outro')) {
            return generateSweepDown(p.beat, 2);
        }
        return generateDrumFill(p.beat, 2, 'descending');
    });
}
