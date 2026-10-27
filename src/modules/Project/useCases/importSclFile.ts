import { notifyUser } from '#/utils/Notification/notifyUser';

import { parseScl } from '../repositories/nativeTuning/parseScl';
import { projectStore } from '../stores/projectStore';

import { pickFiles } from './fileDialog';
import { captureProjectTransitionAuthority } from './projectPersistence/captureProjectTransitionAuthority';
import { markDirty } from './projectPersistence/saveProject/markDirty';

let latestImportRequest = 0;

export async function importSclFile(): Promise<void> {
    const request = ++latestImportRequest;
    const authority = captureProjectTransitionAuthority();
    const isCurrent = () => request === latestImportRequest && authority.isCurrent();
    if (!isCurrent()) {
        return;
    }

    try {
        const paths = await pickFiles({
            multiple: false,
            filters: [{ name: 'Scala', extensions: ['scl'] }],
        });
        if (!isCurrent() || !paths || paths.length === 0) {
            return;
        }

        const firstFile = paths[0];
        if (!firstFile) {
            return;
        }

        const content = await firstFile.text();
        if (!isCurrent()) {
            return;
        }

        const parsed = await parseScl(content);
        if (!isCurrent()) {
            return;
        }
        if (parsed.status === 'invalid') {
            if (isCurrent()) {
                notifyUser(`Failed to import Scala file at line ${parsed.error.line}: ${parsed.error.reason}`, 'error');
            }
            return;
        }
        const result = parsed.scale;

        const project = projectStore.value;
        if (!project || !isCurrent()) {
            return;
        }

        projectStore.set({
            ...project,
            tuning: {
                name: result.name || result.description || 'Custom Scale',
                frequencies: result.frequencies,
            },
        });
        if (!isCurrent()) {
            return;
        }

        markDirty();
        if (!isCurrent()) {
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
        if (!isCurrent()) {
            return;
        }
        notifyUser('Failed to import Scala file', 'error');
        console.error('Scala import error:', error);
    }
}
