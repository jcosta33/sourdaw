type ClipSpan = { startBeat: number; endBeat: number };

/** The beats a freeze renders: the clips' full extent, or the first beat when the track has none. */
export function getFreezeRenderSpan(clips: readonly ClipSpan[]): ClipSpan {
    if (clips.length === 0) {
        return { startBeat: 0, endBeat: 1 };
    }
    return {
        startBeat: Math.min(...clips.map((clip) => clip.startBeat)),
        endBeat: Math.max(...clips.map((clip) => clip.endBeat)),
    };
}
