import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function lockClip(clipId: string, locked: boolean): void {
    updateClip(clipId, (c) => ({ ...c, locked }));
}
