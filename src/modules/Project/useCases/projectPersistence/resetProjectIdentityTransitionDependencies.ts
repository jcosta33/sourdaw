import { projectIdentityTransitionConfiguration } from '../../events/projectIdentityTransitionConfiguration';

export function resetProjectIdentityTransitionDependencies(): void {
    projectIdentityTransitionConfiguration.reset();
}
