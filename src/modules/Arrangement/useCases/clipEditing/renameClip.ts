import { updateClip } from '../../repositories/track/updateClip';

export function renameClip(clipId: string, name: string): void {
    updateClip(clipId, (c) => ({ ...c, name }));
}
