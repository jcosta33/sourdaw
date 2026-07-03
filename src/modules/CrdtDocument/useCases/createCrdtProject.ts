import { automergeRepository } from '../repositories/automergeRepository';

import { compactProject } from './compactProject';

/**
 * Create a new CRDT-backed project.
 */
export async function createCrdtProject(name: string): Promise<void> {
    automergeRepository.createProject(name);
    await compactProject();
}
