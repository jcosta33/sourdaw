import { transientDetectionLifecycle } from './transientDetectionLifecycle';

/** Revoke immediately, including during the sensitivity debounce and editor teardown. */
export function cancelTransientDetection(clipId: string): void {
    transientDetectionLifecycle.cancel(clipId);
}
