import { notifyUser } from '#/utils/Notification/notifyUser';

import { parseScl } from '../repositories/nativeTuning/parseScl';
import { projectStore } from '../stores/projectStore';

import { pickFiles } from './fileDialog';

export async function importSclFile(): Promise<void> {
    const paths = await pickFiles({
        multiple: false,
        filters: [{ name: 'Scala', extensions: ['scl'] }],
    });

    if (!paths || paths.length === 0) {
        return;
    }

    try {
        const firstFile = paths[0];
        if (!firstFile) {
            return;
        }

        const content = await firstFile.text();

        const result = await parseScl(content);

        const project = projectStore.value;
        if (!project) {
            return;
        }

        projectStore.set({
            ...project,
            tuning: {
                name: result.name || result.description || 'Custom Scale',
                frequencies: result.frequencies,
            },
        });

        // No instrument consumes the project tuning table (the old engine
        // forwarding posted 'tuning-table' to a set_param arm no Rust side
        // implemented), so the notice may claim storage only — never a retune
        // (#4675).
        notifyUser(
            `Imported scale "${result.name || 'Custom'}" — stored on the project; no instrument consumes project tuning yet`,
            'success'
        );
    } catch (error) {
        notifyUser('Failed to import Scala file', 'error');
        console.error('Scala import error:', error);
    }
}
