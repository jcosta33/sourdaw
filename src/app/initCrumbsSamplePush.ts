import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';
import { subscribeToCrumbsSamples } from '#/modules/Crumbs/stores';

export function initCrumbsSamplePush(): () => void {
    return subscribeToCrumbsSamples((deviceId) => {
        const track = getAllTracks().find((candidate) => candidate.devices.some((device) => device.id === deviceId));
        if (!track) {
            return;
        }
        const node = getTrackStrip(track.id)?.deviceNodes.find((candidate) => candidate.deviceId === deviceId);
        if (node?.crumbsControls?.ready) {
            node.crumbsControls.refreshSample?.();
        }
    });
}
