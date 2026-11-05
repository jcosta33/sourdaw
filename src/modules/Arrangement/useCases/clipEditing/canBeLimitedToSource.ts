import { type Clip } from '../../models/Track';

/**
 * Whether the source bound can apply to a clip at all: a non-looping audio clip
 * with a source. Whether it does apply also depends on the decoded buffer being
 * cached, so a caller recording history must not rely on recomputing it later.
 */
export function canBeLimitedToSource(clip: Clip): clip is Clip & { audioBufferId: string } {
    return clip.type === 'audio' && !clip.loopEnabled && clip.audioBufferId !== undefined;
}
