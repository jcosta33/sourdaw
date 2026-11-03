import { automergeRepository, type ActiveRootInstallation } from '../repositories/automergeRepository';

/** Observe installed active-root truth before publication or later callbacks can replace it. */
export function subscribeToActiveRootInstallations(
    listener: (installation: ActiveRootInstallation) => void
): () => void {
    return automergeRepository.onRootInstallation(listener);
}
