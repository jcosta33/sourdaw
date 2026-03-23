import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function lockClip(clipId: string, locked: boolean): void {
    updateClip(clipId, (c) => ({ ...c, locked }));
}
