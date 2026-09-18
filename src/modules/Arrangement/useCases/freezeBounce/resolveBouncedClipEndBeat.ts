type ResolveBouncedClipEndBeatInput = {
    /** First beat of the bounced region — where the buffer's first frame lands. */
    startBeat: number;
    /** Musical end of the source content, before any tail. */
    musicalEndBeat: number;
    /** The rendered (and, for auto tail, silence-trimmed) buffer. */
    renderedBuffer: AudioBuffer;
    /**
     * Timeline seconds from beat 0 to `beat`, integrating every tempo change —
     * Transport's canonical placement read (`readSecondsAtBeat`), the same map
     * playback schedules this clip on.
     */
    timelineSecondsAtBeat: (beat: number) => number;
    /**
     * Maps absolute timeline samples to the beat that sounds there
     * (`createSamplePositionProjector`), the canonical inverse of the placement
     * read above.
     */
    projectSampleToBeat: (input: { samples: number; sampleRate: number }) => number;
};

/**
 * End beat for a bounced clip whose buffer may reach past the musical content.
 *
 * An auto-tail render reserves seconds past the region and trims only the
 * silence, so the buffer's length — not the source clips' last beat — is where
 * the captured decay ends. Writing the musical end anyway leaves the tail
 * cached but unplayable: both live scheduling and the offline playback
 * projector stop reading at the clip's end beat. The endpoint is therefore the
 * buffer's own duration mapped back through the tempo map, which also keeps the
 * span correct across tempo changes and nonzero region starts.
 *
 * The musical end still wins when the trim ends the buffer first — tail
 * content below the silence threshold is real silence, not a reason to shrink
 * the clip below the material it replaced.
 */
export function resolveBouncedClipEndBeat(input: ResolveBouncedClipEndBeatInput): number {
    const { startBeat, musicalEndBeat, renderedBuffer } = input;
    const sampleRate = renderedBuffer.sampleRate;
    const startSamples = Math.round(input.timelineSecondsAtBeat(startBeat) * sampleRate);
    const bufferEndBeat = input.projectSampleToBeat({
        samples: startSamples + renderedBuffer.length,
        sampleRate,
    });
    return Math.max(musicalEndBeat, bufferEndBeat);
}
