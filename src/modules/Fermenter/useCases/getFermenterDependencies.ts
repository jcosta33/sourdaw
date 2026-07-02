import { type FermenterDependencies, fermenterDependenciesHolder } from './fermenterDependencies';

export function getFermenterDependencies(): FermenterDependencies {
    if (!fermenterDependenciesHolder.current) {
        throw new Error('Fermenter dependencies not initialized');
    }
    return fermenterDependenciesHolder.current;
}
