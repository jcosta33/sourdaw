import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { type MidiNote } from '../models/MidiNote';
import { midiStore } from '../stores/midiStore';

export type ArpPattern = 'up' | 'down' | 'updown' | 'downup' | 'random';
export type ArpRate = 4 | 8 | 16 | 32;

/** How the generated arpeggio notes combine with the clip's existing notes. */
export type ArpMode = 'replace' | 'merge';

export function arpeggiate(
    clipId: string,
    pattern: ArpPattern = 'up',
    rate: ArpRate = 16,
    octaves: number = 1,
    gatePercent: number = 80,
    mode: ArpMode = 'replace',
    seed?: number
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes || notes.length === 0) {
        return;
    }

    const uniquePitches = [...new Set(notes.map((node) => node.pitch))].sort((alpha, b) => alpha - b);

    const expandedPitches: number[] = [];
    for (let oct = 0; oct < octaves; oct++) {
        for (const pitch of uniquePitches) {
            const param = pitch + oct * 12;
            if (param <= 127) {
                expandedPitches.push(param);
            }
        }
    }

    if (expandedPitches.length === 0) {
        return;
    }

    let sequence: number[];
    switch (pattern) {
        case 'up': {
            sequence = [...expandedPitches];
            break;
        }
        case 'down': {
            sequence = [...expandedPitches].reverse();
            break;
        }
        case 'updown': {
            const inner = expandedPitches.length > 2 ? expandedPitches.slice(1, -1).reverse() : [];
            sequence = [...expandedPitches, ...inner];
            break;
        }
        case 'downup': {
            const rev = [...expandedPitches].reverse();
            const inner = rev.length > 2 ? rev.slice(1, -1).reverse() : [];
            sequence = [...rev, ...inner];
            break;
        }
        case 'random': {
            // Use a seeded PRNG so the shuffle is reproducible (undo/redo,
            // tests) instead of the non-capturable Math.random().
            const rng = createSeededRandom(seed ?? generateSeed());
            sequence = [...expandedPitches];
            for (let index = sequence.length - 1; index > 0; index--) {
                const jIndex = Math.floor(rng() * (index + 1));
                [sequence[index], sequence[jIndex]] = [sequence[jIndex]!, sequence[index]!];
            }
            break;
        }
    }

    if (sequence.length === 0) {
        return;
    }

    let minBeat = Infinity;
    let maxBeat = -Infinity;
    for (const node of notes) {
        if (node.startBeat < minBeat) {
            minBeat = node.startBeat;
        }
        const end = node.startBeat + node.duration;
        if (end > maxBeat) {
            maxBeat = end;
        }
    }

    const stepSize = 4 / rate;
    const gateDuration = stepSize * (gatePercent / 100);
    const newNotes: MidiNote[] = [];
    let stepIndex = 0;

    for (let beat = minBeat; beat < maxBeat; beat += stepSize) {
        const pitch = sequence[stepIndex % sequence.length]!;
        newNotes.push({
            // Globally unique id. The previous `arp-${clipId}-${stepIndex}`
            // collided across repeated runs and across clips, corrupting
            // selection and undo state.
            id: `arp-${crypto.randomUUID()}`,
            pitch,
            startBeat: beat,
            duration: gateDuration,
            velocity: notes[0]?.velocity ?? 100,
        });
        stepIndex++;
    }

    // In 'merge' mode the arpeggio is added to the clip's existing notes; in
    // 'replace' mode (the default) it overwrites them.
    const merged = mode === 'merge' ? [...notes, ...newNotes] : newNotes;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: merged,
        },
    });
}
