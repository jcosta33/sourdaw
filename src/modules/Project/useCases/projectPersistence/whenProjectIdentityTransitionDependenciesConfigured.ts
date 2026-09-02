import { projectIdentityTransitionConfiguration } from './helpers/projectIdentityTransitionConfiguration';

export function whenProjectIdentityTransitionDependenciesConfigured(): Promise<void> {
    return projectIdentityTransitionConfiguration.when();
}
