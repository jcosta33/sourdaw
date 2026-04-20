import { invoke } from '@tauri-apps/api/core';
import { readTextFile } from '@tauri-apps/plugin-fs';

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
        const path = typeof paths[0] === 'string' ? paths[0] : (paths[0] as any).path;
        const content = await readTextFile(path);

        const result = (await (invoke as any)('parse_scl', {
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
