import { readYeastPreviewSnapshot } from './yeastSchedulingBridge/readYeastPreviewSnapshot';
import { setYeastPreviewCaptureEnabled } from './yeastSchedulingBridge/setYeastPreviewCaptureEnabled';

import type { YeastPreviewSnapshot } from '../models/YeastPreviewSnapshot';

type SubscribeYeastPreviewInput = {
    rackId: string;
    routeId?: string;
    trackId: string;
    onSnapshot: (snapshot: YeastPreviewSnapshot, sampledAt: number) => void;
};

const PREVIEW_SAMPLE_INTERVAL_MS = 1000 / 30;

export function subscribeYeastPreview({
    rackId,
    trackId,
    routeId = trackId,
    onSnapshot,
}: SubscribeYeastPreviewInput): () => void {
    const scope = { rackId, routeId, trackId };
    let disposed = false;

    function sample(): void {
        if (disposed) {
            return;
        }
        onSnapshot(readYeastPreviewSnapshot(scope), performance.now());
    }

    setYeastPreviewCaptureEnabled({ ...scope, enabled: true });
    sample();
    const interval = window.setInterval(sample, PREVIEW_SAMPLE_INTERVAL_MS);

    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        window.clearInterval(interval);
        setYeastPreviewCaptureEnabled({ ...scope, enabled: false });
    };
}
