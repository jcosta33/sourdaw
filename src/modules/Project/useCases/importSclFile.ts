import { registerTuningTable } from '#/modules/AudioEngine/useCases';
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

        registerTuningTable(result.frequencies);

        notifyUser(`Imported scale: ${result.name || 'Custom'}`, 'success');
    } catch (error) {
        notifyUser('Failed to import Scala file', 'error');
        console.error('Scala import error:', error);
    }
}
