import { yeastPreviewTap } from '../../engine/yeastPreviewTap';

export function setYeastPreviewCaptureEnabled(enabled: boolean): void {
    yeastPreviewTap.setEnabled(enabled);
}
