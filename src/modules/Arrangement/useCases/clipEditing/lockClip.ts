import { updateClip } from '../../repositories/track/updateClip';

export function lockClip(clipId: string, locked: boolean): boolean {
    return updateClip(clipId, (context) => ({ ...context, locked }));
}
