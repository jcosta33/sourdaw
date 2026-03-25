import { updateClip } from '#/modules/Arrangement/repositories/track';

export function lockClip(clipId: string, locked: boolean): void {
    updateClip(clipId, (c) => ({ ...c, locked }));
}
