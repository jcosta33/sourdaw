import { type TrackKind } from '../../models/Track';

/**
 * Whether a clip of `clipType` may be dropped on a track of `trackKind`.
 * MIDI tracks take only MIDI clips and audio tracks take only audio clips;
 * other kinds (bus/master/folder) are governed by track eligibility, which
 * the clip use cases enforce separately.
 */
export function isClipDropCompatible(clipType: 'audio' | 'midi', trackKind: TrackKind): boolean {
    if (trackKind === 'audio') {
        return clipType === 'audio';
    }
    if (trackKind === 'midi') {
        return clipType === 'midi';
    }
    return true;
}
