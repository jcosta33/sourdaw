import { projectIdentityTransitionConfiguration } from './helpers/projectIdentityTransitionConfiguration';

export function resetProjectIdentityTransitionDependencies(): void {
    projectIdentityTransitionConfiguration.reset();
}
