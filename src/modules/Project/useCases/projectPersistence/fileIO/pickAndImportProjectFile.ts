import { open } from '@tauri-apps/plugin-dialog';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';
import { type ProjectData } from '../../../models/ProjectData';
import { loadProjectFromFile } from '../../../repositories/nativeProjectFiles/loadProjectFromFile';
import { pickFiles } from '../../../repositories/nativeFileDialog/pickFiles';
import { applyImportedProjectData } from './applyImportedProjectData';

export { applyImportedProjectData };

export async function importProjectFile(file: File): Promise<boolean> {
    try {
        const text = await file.text();
        const data = JSON.parse(text) as ProjectData;

        if (data.version !== 1 || !data.tracks || !data.transport) {
            return false;
        }

        return await applyImportedProjectData(data);
    } catch {
        return false;
    }
}

export async function importProjectFromNativePath(path: string): Promise<boolean> {
    try {
        const data = await loadProjectFromFile(path);
        if (data.version !== 1 || !data.tracks || !data.transport) {
            return false;
        }
        return await applyImportedProjectData(data);
    } catch {
        return false;
    }
}

/**
 * Opens the import dialog: on Tauri, native open + `read_audio_file`; in the browser, file input + `File.text()`.
 */
export async function pickAndImportProjectFile(): Promise<void> {
    if (isTauri()) {
        const path = await open({
            multiple: false,
            filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw', 'json'] }],
        });
        if (path === null || path === undefined) {
            return;
        }
        const singlePath = Array.isArray(path) ? path[0] : path;
        if (!singlePath) {
            return;
        }
        const ok = await importProjectFromNativePath(singlePath);
        if (!ok) {
            notifyUser('Could not import project — invalid or corrupted file.', 'warning');
            return;
        }
        notifyUser('Project imported successfully', 'info');
        return;
    }
    const files = await pickFiles({
        filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw', 'json'] }],
        multiple: false,
    });
    if (!files || files.length === 0) {
        return;
    }
    const ok = await importProjectFile(files[0]!);
    if (!ok) {
        notifyUser('Could not import project — invalid or corrupted file.', 'warning');
        return;
    }
    notifyUser('Project imported successfully', 'info');
}