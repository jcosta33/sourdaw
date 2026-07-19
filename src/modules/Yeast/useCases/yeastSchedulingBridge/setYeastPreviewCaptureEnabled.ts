import { yeastPreviewTap } from '../../engine/yeastPreviewTap';
import { YEAST_PREVIEW_RACK_ID } from '../../models/YeastPreviewSnapshot';

type SetYeastPreviewCaptureEnabledInput = {
    trackId: string;
    enabled: boolean;
};

export function setYeastPreviewCaptureEnabled({ trackId, enabled }: SetYeastPreviewCaptureEnabledInput): void {
    yeastPreviewTap.setEnabled({ rackId: YEAST_PREVIEW_RACK_ID, routeId: trackId, trackId }, enabled);
}
