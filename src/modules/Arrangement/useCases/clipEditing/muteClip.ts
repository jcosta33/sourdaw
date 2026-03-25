import { updateClip } from '#/modules/Arrangement/repositories/track';

export function muteClip(clipId: string, muted: boolean): void {
    updateClip(clipId, (c) => ({ ...c, muted }));
}
