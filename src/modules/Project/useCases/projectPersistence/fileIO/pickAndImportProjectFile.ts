import { readTextFile } from '@tauri-apps/plugin-fs';
import { type ProjectData } from '../../../models/ProjectData';
import { pickFiles } from '../../fileDialog';
import { applyImportedProjectData } from './applyImportedProjectData';
import { notifyUser } from '#/utils/Notification/notifyUser';

export async function importProjectFile(file: File): Promise<boolean> {
    try {
        const content = await file.text();
        const data = JSON.parse(content) as ProjectData;

        if (data.version !== 1 || !data.arrangement?.tracks || !data.meta) {
            notifyUser('Invalid project file format', 'error');
            return false;
        }

        return await applyImportedProjectData(data);
    } catch (error) {
        notifyUser('Failed to read project file', 'error');
        console.error('Import error:', error);
        return false;
    }
}

import { loadProjectFromFile } from '../../../repositories/nativeProjectFiles/loadProjectFromFile';

export async function importProjectFromNativePath(path: string): Promise<boolean> {
    try {
        const data = await loadProjectFromFile(path);
        if (data.version !== 1 || !data.arrangement?.tracks || !data.meta) {
            notifyUser('Invalid project file format', 'error');
            return false;
        }
        return await applyImportedProjectData(data);
    } catch (error) {
        notifyUser('Failed to read project file', 'error');
        console.error('Import error:', error);
        return false;
    }
}

export async function pickAndImportProjectFile(): Promise<boolean> {
    const paths = await pickFiles({
        multiple: false,
        filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
    });

    if (!paths || paths.length === 0) return false;

    try {
        const path = typeof paths[0] === 'string' ? paths[0] : (paths[0] as any).path;
        const content = await readTextFile(path);
        const data = JSON.parse(content) as ProjectData;

        if (data.version !== 1 || !data.arrangement?.tracks || !data.meta) {
            notifyUser('Invalid project file format', 'error');
            return false;
        }

        return await applyImportedProjectData(data);
    } catch (error) {
        notifyUser('Failed to read project file', 'error');
        console.error('Import error:', error);
        return false;
    }
}
