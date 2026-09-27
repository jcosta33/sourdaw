/**
 * Whether a clip of `clipType` can live on a track of `trackKind`: only
 * content-bearing track kinds (audio, midi) host clips, and each takes only
 * its own clip type.
 *
 * This is the single kind-compatibility core behind the Arrangement placement
 * rule (`isClipDropCompatible`, which adds the store eligibility guard) and
 * the AI clip-placement transformers, which cannot import module code — so
 * every placement route refuses the same destinations the timeline drop
 * refuses.
 */
export function isClipCompatibleWithTrackKind(clipType: 'audio' | 'midi', trackKind: string): boolean {
    if (trackKind !== 'audio' && trackKind !== 'midi') {
        return false;
    }
    return trackKind === clipType;
}
