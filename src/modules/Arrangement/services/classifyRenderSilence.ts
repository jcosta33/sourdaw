/**
 * Why a silent render must not be refused.
 *
 * Every value is an *abstention*, not a diagnosis. The guard's only job is to
 * avoid destroying work; being wrong in this direction costs a missed catch,
 * being wrong in the other costs the user a legitimate operation. So each of
 * these is deliberately broad.
 */
export type RenderSilenceAbstention =
    /** The scheduler put nothing into the graph, so silence is the correct output. */
    | 'nothing-scheduled'
    /** Everything the scheduler did put in was itself digital silence. */
    | 'all-sources-silent'
    /** The render bakes this track's fader and the user has it at zero. */
    | 'fader-zeroed'
    /**
     * The render bakes automation for this track. Any lane can resolve to a
     * gain of zero, and this guard does not model automation curves — so it
     * stands down rather than guess.
     */
    | 'automation-not-modelled';

export type ClassifyRenderSilenceOutput =
    { unexpected: true } | { unexpected: false; abstention: RenderSilenceAbstention };

export type ClassifyRenderSilenceInput = {
    /** MIDI notes the scheduler actually handed to an instrument. */
    scheduledNotes: number;
    /** Source buffers the scheduler actually started. */
    scheduledBuffers: readonly AudioBuffer[];
    /** Whether a given started buffer is itself digital silence. */
    isSilentSource: (buffer: AudioBuffer) => boolean;
    /**
     * The static fader value this render bakes into the samples.
     *
     * Not simply `track.gain`: freeze prints the target at unity because the
     * buffer is replayed *through* that same fader (`targetMixer: 'keepLive'`
     * in `projectStripTrack`), so a track parked at zero still has to print.
     */
    bakedFaderGain: number;
    /** Whether this render bakes any of the track's automation lanes. */
    bakesAutomation: boolean;
    /** Whether the track owns at least one enabled lane carrying points. */
    hasAutomationLanes: boolean;
};

/**
 * Given what a render actually scheduled, is a silent result unexpected?
 *
 * The expensive question — are the started buffers themselves silent — is
 * asked last, so a caller that only reaches here on an already-silent output
 * pays for the source scans only on the refusal path.
 */
export function classifyRenderSilence({
    scheduledNotes,
    scheduledBuffers,
    isSilentSource,
    bakedFaderGain,
    bakesAutomation,
    hasAutomationLanes,
}: ClassifyRenderSilenceInput): ClassifyRenderSilenceOutput {
    if (scheduledNotes === 0 && scheduledBuffers.length === 0) {
        return { unexpected: false, abstention: 'nothing-scheduled' };
    }
    if (Number.isNaN(bakedFaderGain) || bakedFaderGain <= 0) {
        return { unexpected: false, abstention: 'fader-zeroed' };
    }
    if (bakesAutomation && hasAutomationLanes) {
        return { unexpected: false, abstention: 'automation-not-modelled' };
    }

    if (scheduledNotes === 0) {
        const everySourceSilent = scheduledBuffers.every((buffer) => isSilentSource(buffer));
        if (everySourceSilent) {
            return { unexpected: false, abstention: 'all-sources-silent' };
        }
    }

    return { unexpected: true };
}
