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
export const activeRecordingRef: { current: string[]; capturedRootIdentity: string | null } = {
    current: [],
    capturedRootIdentity: null,
};
