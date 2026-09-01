import {
    projectIdentityTransitionConfiguration,
    projectIdentityTransitionDependencies,
    type ProjectIdentityTransitionDependencies,
} from '../../events/projectIdentityTransitionConfiguration';

export { projectIdentityTransitionDependencies };

export function setProjectIdentityTransitionDependencies(dependencies: ProjectIdentityTransitionDependencies): void {
    projectIdentityTransitionConfiguration.apply(dependencies);
}
