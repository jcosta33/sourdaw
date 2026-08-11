type DescribeShortMidiOverlapRemovalInput = {
    trackId: string;
    trackName: string;
    clipId: string;
    clipName: string;
    maximumOverlapMs: number;
    shortenedNotes: readonly {
        noteId: string;
        previousDuration: number;
        nextDuration: number;
        overlapMs: number;
    }[];
};

function round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

export function describeShortMidiOverlapRemoval(input: DescribeShortMidiOverlapRemovalInput): string {
    const noteChanges = input.shortenedNotes
        .map(
            (note) =>
                `note ${note.noteId} duration ${String(round(note.previousDuration))} → ${String(round(note.nextDuration))} beats (remove ${String(round(note.overlapMs))} ms overlap)`
        )
        .join('; ');
    return `Track "${input.trackName}" (${input.trackId}), clip "${input.clipName}" (${input.clipId}): shorten ${String(input.shortenedNotes.length)} same-pitch/channel overlap${input.shortenedNotes.length === 1 ? '' : 's'} strictly below ${String(input.maximumOverlapMs)} ms; ${noteChanges}; preserve note starts, pitches, velocities, channels, expression, articulations, and overlaps at or above ${String(input.maximumOverlapMs)} ms`;
}
