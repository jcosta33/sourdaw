import {
    projectIdentityTransitionConfiguration,
    projectIdentityTransitionDependencies,
    type ProjectIdentityTransitionDependencies,
} from './helpers/projectIdentityTransitionConfiguration';

export { projectIdentityTransitionDependencies };

export function setProjectIdentityTransitionDependencies(dependencies: ProjectIdentityTransitionDependencies): void {
    projectIdentityTransitionConfiguration.apply(dependencies);
}
