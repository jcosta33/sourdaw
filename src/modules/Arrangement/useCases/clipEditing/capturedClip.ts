import { type ClipStateSnapshot } from '../../events/arrangementClipStateSnapshots';
import { type Clip } from '../../stores/trackStore';

export function capturedClip(snapshot: ClipStateSnapshot): Clip {
    const { kneadState, overrides, ...fields } = structuredClone(snapshot);
    const clip: Clip = fields;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = overrides ? structuredClone(overrides) : undefined;
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        if (kneadState) {
            clip.kneadState = {
                ...kneadState,
                blobs: kneadState.blobs.map((blob) => ({ ...blob, pitchCurveCents: [...blob.pitchCurveCents] })),
            };
        } else {
            clip.kneadState = undefined;
        }
    }
    return clip;
}
