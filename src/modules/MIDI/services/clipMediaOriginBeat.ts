type ClipMediaSpan = {
    startBeat: number;
    midiOffsetBeats?: number;
};

/**
 * The timeline beat a clip's stored rows count from: a row at clip beat `b`
 * plays at `clipMediaOriginBeat + b`. A clip trimmed at its head starts later
 * than its media does.
 */
export function clipMediaOriginBeat(clip: ClipMediaSpan): number {
    return clip.startBeat - (clip.midiOffsetBeats ?? 0);
}
