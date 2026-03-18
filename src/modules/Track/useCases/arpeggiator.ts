import { midiStore } from '#/modules/Track/stores/midiStore';
import { type MidiNote } from '#/modules/Track/models/MidiNote';

export type ArpPattern = 'up' | 'down' | 'updown' | 'downup' | 'random';
export type ArpRate = 4 | 8 | 16 | 32;

export function arpeggiate(
    clipId: string,
    pattern: ArpPattern = 'up',
    rate: ArpRate = 16,
    octaves: number = 1,
    gatePercent: number = 80
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes || notes.length === 0) {
        return;
    }

    const uniquePitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);

    const expandedPitches: number[] = [];
    for (let oct = 0; oct < octaves; oct++) {
        for (const pitch of uniquePitches) {
            const p = pitch + oct * 12;
            if (p <= 127) {
                expandedPitches.push(p);
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
            sequence = [...expandedPitches];
            for (let i = sequence.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sequence[i], sequence[j]] = [sequence[j]!, sequence[i]!];
            }
            break;
        }
    }

    if (sequence.length === 0) {
        return;
    }

    const minBeat = Math.min(...notes.map((n) => n.startBeat));
    const maxBeat = Math.max(...notes.map((n) => n.startBeat + n.duration));

    const stepSize = 4 / rate;
    const gateDuration = stepSize * (gatePercent / 100);
    const newNotes: MidiNote[] = [];
    let stepIndex = 0;

    for (let beat = minBeat; beat < maxBeat; beat += stepSize) {
        const pitch = sequence[stepIndex % sequence.length]!;
        newNotes.push({
            id: `arp-${clipId}-${stepIndex}`,
            pitch,
            startBeat: beat,
            duration: gateDuration,
            velocity: notes[0]?.velocity ?? 100,
        });
        stepIndex++;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: newNotes,
        },
    });
}
