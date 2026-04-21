import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { applyImportedProjectData } from '../projectPersistence/fileIO/applyImportedProjectData';

import { decodeDawProjectAssets } from './decodeDawProjectAssets';
import { mapToProjectData } from './mapToProjectData';
import { parseDawProject } from './parseDawProject';

export type ImportDawProjectInput = {
    buffer: ArrayBuffer;
    fileName: string;
};

export type ImportDawProjectOutput = Promise<boolean>;

export async function importDawProject(input: ImportDawProjectInput): ImportDawProjectOutput {
    let parsed;
    try {
        parsed = parseDawProject(input.buffer);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        notifyUser(`Failed to read DAWproject file: ${message}`, 'error');
        logger.warn('[importDawProject] parse failure', error);
        return false;
    }

    const { bufferIdsByPath, failedPaths } = await decodeDawProjectAssets(parsed.audioAssets);
    if (failedPaths.length > 0) {
        logger.warn(`[importDawProject] Failed to decode ${String(failedPaths.length)} audio asset(s)`, failedPaths);
    }

    const projectData = mapToProjectData({
        parsed,
        bufferIdsByPath,
        fileName: input.fileName,
    });

    try {
        const ok = await applyImportedProjectData(projectData);
        if (ok) {
            const trackCount = projectData.arrangement.tracks.length;
            notifyUser(`Imported ${parsed.meta.title || input.fileName} (${String(trackCount)} tracks)`, 'success');
        }
        return ok;
    } catch (error) {
        notifyUser('Failed to apply imported DAWproject data', 'error');
        logger.warn('[importDawProject] apply failure', error);
        return false;
    }
}
