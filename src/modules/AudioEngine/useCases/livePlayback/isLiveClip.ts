import { type Track } from '#/modules/Arrangement/stores';

/**
 * A live session plays the arrangement from its head, so every time a live
 * producer projects is an absolute timeline second. The export's region offset
 * is the only reason `projectOfflineAudioClipPlaybacks` takes a region at all,
 * and a live session has none.
 */
export const LIVE_REGION_START_BEAT = 0;

/**
 * Whether this clip is material a live session sounds at all.
 *
 * A muted clip, one that ends before the live region starts, and one with no
 * positive length are played by neither carrier, so neither the native
 * programme nor the set of strips left to Web Audio owes them an answer. One
 * definition, shared by `projectLiveGraphProgramme` and
 * `stripIdsHoldingLiveClips`, because the two answers have to agree: a clip one
 * of them counts and the other does not is a strip the carrier law reads wrong.
 */
export function isLiveClip(clip: Track['clips'][number]): boolean {
    return !clip.muted && clip.endBeat > LIVE_REGION_START_BEAT && clip.endBeat - clip.startBeat > 0;
}
