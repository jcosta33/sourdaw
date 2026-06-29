/**
 * Ephemeral inline MIDI note drag preview.
 *
 * Timeline note drags must not mutate midiStore on every mousemove. The
 * presentation hook writes this ref, buildTimelineRenderModel overlays it for
 * visual feedback, and mouseup commits the final value through an owned use case.
 */
export type InlineMidiNotePreview = {
    clipId: string;
    noteId: string;
    pitch: number;
    startBeat: number;
};

export const inlineMidiNotePreviewRef: { current: InlineMidiNotePreview | null } = { current: null };
