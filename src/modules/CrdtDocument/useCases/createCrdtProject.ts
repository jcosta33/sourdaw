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
    if (reset.status === 'transport-active') {
        // The bootstrap runs before any transport gesture can exist, so a rolling
        // transport here is a broken precondition rather than a retry to make.
        throw new Error('[createCrdtProject] Project reset refused (transport-active)');
    }
    await compactProject();
    const outcome = await reset.finalize();
    if (outcome !== 'finalized') {
        throw new Error(`[createCrdtProject] Project reset did not finalize (${outcome})`);
    }
}
