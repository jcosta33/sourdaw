import { compactProject } from './compactProject';
import { resetCrdtProjectAuthority } from './resetCrdtProjectAuthority';

/**
 * Create a new CRDT-backed project.
 */
export async function createCrdtProject(name: string): Promise<void> {
    resetCrdtProjectAuthority(name);
    await compactProject();
}
