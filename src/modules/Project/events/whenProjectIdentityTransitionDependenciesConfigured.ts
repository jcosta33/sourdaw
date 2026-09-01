import { projectIdentityTransitionConfiguration } from './projectIdentityTransitionConfiguration';

export function whenProjectIdentityTransitionDependenciesConfigured(): Promise<void> {
    return projectIdentityTransitionConfiguration.when();
}
