import { updateClip } from '#/modules/Arrangement/repositories/track';

export function renameClip(clipId: string, name: string): void {
    updateClip(clipId, (c) => ({ ...c, name }));
}
