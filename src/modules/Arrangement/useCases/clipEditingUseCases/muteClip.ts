import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function muteClip(clipId: string, muted: boolean): void {
    updateClip(clipId, (c) => ({ ...c, muted }));
}
