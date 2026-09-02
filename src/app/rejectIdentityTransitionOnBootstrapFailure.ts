import { failProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

export function rejectIdentityTransitionOnBootstrapFailure(reason: unknown): void {
    failProjectIdentityTransitionDependencies(reason);
}
