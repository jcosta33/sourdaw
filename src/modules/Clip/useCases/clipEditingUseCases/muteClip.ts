import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function muteClip(clipId: string, muted: boolean): void {
    updateClip(clipId, (c) => ({ ...c, muted }));
}
