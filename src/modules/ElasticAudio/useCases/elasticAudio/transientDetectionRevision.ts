import { transientDetectionLifecycle } from './transientDetectionLifecycle';

export function transientDetectionRevision(clipId: string): number {
    return transientDetectionLifecycle.revision(clipId);
}
