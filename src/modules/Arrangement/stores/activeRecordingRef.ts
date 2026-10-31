/**
 * Ephemeral ref tracking clips that are actively being recorded.
 * Read by buildTimelineRenderModel to render the clip growing in real-time
 * by using the current playhead position as the live endBeat.
 *
 * `capturedRootIdentity` is the project-root identity epoch at the moment
 * `startRecording` staged the take (#5517): the Stop finaliser refuses to
 * close or commit the take under any other root, the same ownership witness
 * the capture terminal uses (#5289). `null` means no witness was recorded
 * (a legacy in-flight take), which reads as always-owning.
 */
export type RecordingMidiAdmission = {
    id: string;
    clipId: string;
    trackId: string;
    channel: number;
    note: number;
    velocity: number;
    onsetAudioTime: number;
    onsetSourceBeat: number;
    /** Pass relative to this recording's first seam, captured with the onset. */
    onsetPassIndex?: number;
    releaseAudioTime?: number;
    releaseSourceBeat?: number;
    initialExpression?: {
        pressure?: number;
        slide?: number;
        pitchBend?: number;
        pitchBendRangeSemitones?: number;
    };
    expressionChanges?: Array<{
        dimension: 'pressure' | 'slide' | 'pitchBend';
        value: number;
        audioTime: number;
        sourceBeat: number;
        bendRangeSemitones?: number;
    }>;
};

export const activeRecordingRef: {
    current: string[];
    capturedRootIdentity: string | null;
    startWrapCount: number;
    /** A pass ended without a loop wrap; later MIDI notes and takes carry no pass. */
    passIdentityLost: boolean;
    startBeat: number;
    startedLooping: boolean;
    midiAdmissions: RecordingMidiAdmission[];
} = {
    current: [],
    capturedRootIdentity: null,
    startWrapCount: 0,
    passIdentityLost: false,
    startBeat: 0,
    startedLooping: false,
    midiAdmissions: [],
};
