import { failProjectIdentityTransitionDependencies } from '#/modules/Project/events';

export function rejectIdentityTransitionOnBootstrapFailure(reason: unknown): void {
    failProjectIdentityTransitionDependencies(reason);
}
