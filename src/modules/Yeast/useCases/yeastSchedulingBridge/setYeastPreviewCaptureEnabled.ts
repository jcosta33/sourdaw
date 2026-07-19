import { yeastPreviewTap } from '../../engine/yeastPreviewTap';

type SetYeastPreviewCaptureEnabledInput = {
    rackId: string;
    routeId?: string;
    trackId: string;
    enabled: boolean;
};

export function setYeastPreviewCaptureEnabled({
    rackId,
    trackId,
    routeId = trackId,
    enabled,
}: SetYeastPreviewCaptureEnabledInput): void {
    yeastPreviewTap.setEnabled({ rackId, routeId, trackId }, enabled);
}
