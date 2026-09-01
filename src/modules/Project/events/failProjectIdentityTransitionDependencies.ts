import { projectIdentityTransitionConfiguration } from './projectIdentityTransitionConfiguration';

export function failProjectIdentityTransitionDependencies(reason: unknown): void {
    projectIdentityTransitionConfiguration.fail(reason);
}
