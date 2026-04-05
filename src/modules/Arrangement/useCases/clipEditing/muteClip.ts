import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export function muteClip(clipId: string, muted: boolean): void {
    updateClip(clipId, (c) => ({ ...c, muted }));
}
