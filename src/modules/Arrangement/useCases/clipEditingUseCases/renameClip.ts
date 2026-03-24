import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function renameClip(clipId: string, name: string): void {
    updateClip(clipId, (c) => ({ ...c, name }));
}
