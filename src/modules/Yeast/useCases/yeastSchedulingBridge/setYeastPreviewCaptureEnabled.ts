import { yeastPreviewTap } from '../../engine/yeastPreviewTap';
import { releaseYeastRuntimePreview } from '../../engine/yeastRuntime';

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
    const released = yeastPreviewTap.setEnabled({ rackId, routeId, trackId }, enabled);
    if (released) {
        releaseYeastRuntimePreview(released);
    }
}
