import { compactProject } from './compactProject';
import { resetCrdtProject } from './resetCrdtProject';

/**
 * Create a new CRDT-backed project.
 *
 * Throws on a refused reset as well as an unfinalized one: this is the
 * bootstrap path, and a caller told the project exists must be able to rely on
 * its branch list and its durable bundle describing the same project.
 */
export async function createCrdtProject(name: string): Promise<void> {
    const reset = await resetCrdtProject(name);
    if (reset.status === 'refused') {
        throw new Error(`[createCrdtProject] Project reset refused (${reset.reason})`);
    }
    await compactProject();
    const outcome = await reset.finalize();
    if (outcome !== 'finalized') {
        throw new Error(`[createCrdtProject] Project reset did not finalize (${outcome})`);
    }
}
