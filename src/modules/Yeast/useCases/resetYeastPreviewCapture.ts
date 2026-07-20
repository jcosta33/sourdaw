import { resetYeastRuntimePreview } from '../engine/yeastRuntime';

type ResetYeastPreviewCaptureInput = Readonly<{
    rackId: string;
    routeId: string;
    trackId: string;
}>;

export function resetYeastPreviewCapture(input: ResetYeastPreviewCaptureInput): number | null {
    return resetYeastRuntimePreview(input);
}
