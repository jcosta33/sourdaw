import { updateClip } from '../updateClip';

/**
 * Toggle inline MIDI editing for a clip in the arrangement.
 * When active, the clip renders interactive notes directly in the timeline.
 */
export function toggleInlineEditing(clipId: string, force?: boolean): void {
    updateClip(clipId, (c) => ({
        ...c,
        isInlineEditing: force !== undefined ? force : !c.isInlineEditing,
    }));
}
