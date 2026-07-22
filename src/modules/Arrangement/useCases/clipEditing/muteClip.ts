import { updateClip } from '../../repositories/track/updateClip';

export function muteClip(clipId: string, muted: boolean): boolean {
    return updateClip(clipId, (context) => ({ ...context, muted }));
}
