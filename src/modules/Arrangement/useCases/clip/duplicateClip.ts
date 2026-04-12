import { duplicateClipCore } from './duplicateClipCore';

export function duplicateClip(clipId: string): void {
    duplicateClipCore(clipId, (clip) => clip.endBeat);
}
