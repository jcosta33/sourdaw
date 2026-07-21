import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { setSend as setSendEngine } from '#/modules/AudioEngine/useCases';

export function setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
    const tracks = trackStore.value?.tracks;
    const sourceTrack = tracks?.find((track) => track.id === sourceTrackId);
    const targetTrack = tracks?.find((track) => track.id === busId);
    if (sourceTrack && !getTrackEligibility(sourceTrack.kind).acceptsRoutingEndpoint) {
        return;
    }
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return;
    }
    setSendEngine(sourceTrackId, busId, level, preFader);
}
