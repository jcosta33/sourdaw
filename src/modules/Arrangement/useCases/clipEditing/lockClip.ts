import { updateClip } from '../../repositories/track/updateClip';

export function lockClip(clipId: string, locked: boolean): void {
    updateClip(clipId, (context) => ({ ...context, locked }));
}
