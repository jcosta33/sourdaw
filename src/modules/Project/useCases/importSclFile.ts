import { notifyUser } from '#/utils/Notification/notifyUser';

import { parseScl } from '../repositories/nativeTuning/parseScl';
import { projectStore } from '../stores/projectStore';

import { pickFiles } from './fileDialog';
import { captureProjectTransitionAuthority } from './projectPersistence/captureProjectTransitionAuthority';

export async function importSclFile(): Promise<void> {
    const authority = captureProjectTransitionAuthority();
    if (!authority.isCurrent()) {
        return;
    }

    try {
        const paths = await pickFiles({
            multiple: false,
            filters: [{ name: 'Scala', extensions: ['scl'] }],
        });
        if (!authority.isCurrent() || !paths || paths.length === 0) {
            return;
        }

        const firstFile = paths[0];
        if (!firstFile) {
            return;
        }

        const content = await firstFile.text();
        if (!authority.isCurrent()) {
            return;
        }

        const parsed = await parseScl(content);
        if (!authority.isCurrent()) {
            return;
        }
        if (parsed.status === 'invalid') {
            notifyUser(`Failed to import Scala file at line ${parsed.error.line}: ${parsed.error.reason}`, 'error');
            return;
        }
        const result = parsed.scale;

        const project = projectStore.value;
        if (!project || !authority.isCurrent()) {
            return;
        }

        projectStore.set({
            ...project,
            tuning: {
                name: result.name || result.description || 'Custom Scale',
                frequencies: result.frequencies,
            },
        });
        if (!authority.isCurrent()) {
            return;
        }

        // No instrument consumes the project tuning table (the old engine
        // forwarding posted 'tuning-table' to a set_param arm no Rust side
        // implemented), so the notice may claim storage only — never a retune
        // (#4675).
        notifyUser(
            `Imported scale "${result.name || 'Custom'}" — stored on the project; no instrument consumes project tuning yet`,
            'success'
        );
    } catch (error) {
        if (!authority.isCurrent()) {
            return;
        }
        notifyUser('Failed to import Scala file', 'error');
        console.error('Scala import error:', error);
    }
}
