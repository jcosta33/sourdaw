import { type TrackKind } from '../../models/Track';

/** Human-readable rejection reason for an incompatible drop, surfaced at drop time. */
export function clipDropRejectionReason(trackKind: TrackKind): string {
    if (trackKind === 'midi') {
        return 'Audio clips cannot be dropped on MIDI tracks';
    }
    if (trackKind === 'audio') {
        return 'MIDI clips cannot be dropped on audio tracks';
    }
    return 'This track does not accept clips';
}
