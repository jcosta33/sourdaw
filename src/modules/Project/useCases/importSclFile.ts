// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- this IS a repository/adapter layer: invoke bridges native parse_scl command
import { invoke } from '@tauri-apps/api/core';

import { registerTuningTable } from '#/modules/AudioEngine';
import { notifyUser } from '#/utils/Notification/notifyUser';

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

        const result = (await invoke('parse_scl', {
            content,
        })) as {
            name: string;
            description: string;
            frequencies: number[];
        };

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
