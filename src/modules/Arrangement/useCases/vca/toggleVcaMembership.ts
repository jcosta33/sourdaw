import { getTrackById } from '../../repositories/track/getTrackById';
import { assignTrackToVCA } from '../vcaFader/assignTrackToVCA';
import { removeTrackFromVCA } from '../vcaFader/removeTrackFromVCA';

export function toggleVcaMembership(trackId: string, vcaGroupId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    if (track.vcaGroupId === vcaGroupId) {
        removeTrackFromVCA(trackId);
    } else {
        assignTrackToVCA(trackId, vcaGroupId);
    }
}
