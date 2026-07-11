import { automergeRepository } from '../repositories/automergeRepository';

import { compactProject } from './compactProject';

/**
 * Create a new CRDT-backed project.
 */
type CreateCrdtProjectInput = {
    name: string;
    canActivate: () => boolean;
};

export async function createCrdtProject({ name, canActivate }: CreateCrdtProjectInput): Promise<boolean> {
    if (!canActivate()) {
        return false;
    }
    automergeRepository.createProject(name);
    await compactProject();
    return canActivate();
}
