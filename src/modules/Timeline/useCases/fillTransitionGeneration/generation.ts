/**
 * AI Fill & Transition Generation — drum fills, risers, sweeps, and transitions.
 */

import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { type GeneratedFill } from './types';

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

    notes.push({
        pitch: DRUM_MAP.crash,
        startBeat: atBeat + durationBeats,
        duration: 1,
        velocity: 120,
    });

    return { notes, durationBeats, style: 'drum-fill', confidence: 0.85 };
}

export function generateRiser(
    atBeat: number,
    durationBeats: number = 4,
    startPitch: number = 60,
    endPitch: number = 84
): GeneratedFill {
    const notes: GeneratedFill['notes'] = [];
    const steps = Math.floor(durationBeats * 4);
    const pitchRange = endPitch - startPitch;

    for (let i = 0; i < steps; i++) {
        const progress = i / steps;
        const pitch = Math.round(startPitch + pitchRange * progress);
        const velocity = Math.min(127, Math.round(60 + 67 * progress));

        notes.push({
            pitch,
            startBeat: atBeat + (i * durationBeats) / steps,
            duration: durationBeats / steps,
            velocity,
        });
    }

    return { notes, durationBeats, style: 'riser', confidence: 0.75 };
}

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
        const velocity = Math.min(127, Math.round(100 - 40 * progress));

        notes.push({
            pitch,
            startBeat: atBeat + (i * durationBeats) / steps,
            duration: durationBeats / steps,
            velocity,
        });
    }

    return { notes, durationBeats, style: 'sweep-down', confidence: 0.7 };
}

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
            beat: current.endBeat - 2,
            fromSection: current.name,
            toSection: next.name,
        });
    }

    return transitions;
}

export function generateAllTransitionFills(): GeneratedFill[] {
    const points = detectTransitionPoints();
    return points.map((p) => {
        if (p.toSection.toLowerCase().includes('chorus') || p.toSection.toLowerCase().includes('drop')) {
            return generateRiser(p.beat, 4);
        }
        if (p.toSection.toLowerCase().includes('break') || p.toSection.toLowerCase().includes('outro')) {
            return generateSweepDown(p.beat, 2);
        }
        return generateDrumFill(p.beat, 2, 'descending');
    });
}
