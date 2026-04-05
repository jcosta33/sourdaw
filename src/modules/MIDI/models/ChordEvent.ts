import { type ChordType } from '../useCases/chordStamps';

export type ChordEvent = {
    id: string;
    beat: number;
    root: number; // 0-11 (C=0, C#=1, ... B=11)
    quality: ChordType;
    duration: number; // in beats
};

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function formatChordName(event: ChordEvent): string {
    const rootName = ROOT_NAMES[event.root % 12] ?? 'C';
    const qualitySuffix = event.quality === 'major' ? '' : event.quality;
    return `${rootName}${qualitySuffix}`;
}

export function createChordEvent(beat: number, root: number, quality: ChordType, duration: number): ChordEvent {
    return {
        id: `chord-${crypto.randomUUID().slice(0, 8)}`,
        beat,
        root: root % 12,
        quality,
        duration,
    };
}
