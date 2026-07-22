import { updateClip } from '../../repositories/track/updateClip';

export function renameClip(clipId: string, name: string): boolean {
    return updateClip(clipId, (context) => ({ ...context, name }));
}
