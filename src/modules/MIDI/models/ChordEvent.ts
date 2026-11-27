import { NOTE_NAMES } from '#/utils/noteNames';

import { type ChordType } from './ChordTypes';

export type ChordEvent = {
    id: string;
    beat: number;
    root: number; // 0-11 (C=0, C#=1, ... B=11)
    quality: ChordType;
    duration: number; // in beats
};

/** The shortest chord a track holds, in beats; shorter values are refused, not clamped. */
export const MIN_CHORD_DURATION_BEATS = 0.25;

export const ROOT_NAMES = NOTE_NAMES;

export function formatChordName(event: ChordEvent): string {
    const rootName = ROOT_NAMES[((event.root % 12) + 12) % 12] ?? 'C';
    const qualitySuffix = event.quality === 'major' ? '' : event.quality;
    return `${rootName}${qualitySuffix}`;
}

export function createChordEvent(beat: number, root: number, quality: ChordType, duration: number): ChordEvent {
    return {
        id: `chord-${crypto.randomUUID()}`,
        beat,
        root: ((root % 12) + 12) % 12,
        quality,
        duration,
    };
}

function compareIds(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

/** The order a chord track keeps: by beat, then id, so a reload reproduces the live order exactly. */
export function compareChordEvents(left: ChordEvent, right: ChordEvent): number {
    return left.beat - right.beat || compareIds(left.id, right.id);
}
