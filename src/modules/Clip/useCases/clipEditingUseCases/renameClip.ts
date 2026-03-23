import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function renameClip(clipId: string, name: string): void {
    updateClip(clipId, (c) => ({ ...c, name }));
}
