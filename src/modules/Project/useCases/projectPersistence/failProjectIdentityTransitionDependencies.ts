import { projectIdentityTransitionConfiguration } from './helpers/projectIdentityTransitionConfiguration';

export function failProjectIdentityTransitionDependencies(reason: unknown): void {
    projectIdentityTransitionConfiguration.fail(reason);
}
