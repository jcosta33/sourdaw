import { logger } from '#/infra/logger/appLogger';
import { applyImportedProjectData, runProjectLoadTransaction } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { decodeDawProjectAssets } from './decodeDawProjectAssets';
import { mapToProjectData } from './mapToProjectData';
import { parseDawProject } from './parseDawProject';

export type ImportDawProjectInput = {
    buffer: ArrayBuffer;
    fileName: string;
    /** The caller keeps this true only while the user still wants this replacement. */
    shouldProceed?: () => boolean;
};

export type ImportDawProjectOutput = Promise<boolean>;

export async function importDawProject(input: ImportDawProjectInput): ImportDawProjectOutput {
    const { shouldProceed = () => true } = input;
    const transaction = runProjectLoadTransaction();
    const shouldContinue = (): boolean => transaction.canActivate() && shouldProceed();
    let parsed;
    try {
        parsed = await parseDawProject(input.buffer);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        notifyUser(`Failed to read DAWproject file: ${message}`, 'error');
        logger.warn('[importDawProject] parse failure', error);
        return false;
    }

    const { audioBuffers, bufferIdsByPath, failedPaths } = await decodeDawProjectAssets({
        audioAssets: parsed.audioAssets,
        shouldContinue,
    });
    if (!shouldContinue()) {
        return false;
    }
    if (failedPaths.length > 0) {
        logger.warn(`[importDawProject] Failed to decode ${String(failedPaths.length)} audio asset(s)`, failedPaths);
    }

    const projectData = mapToProjectData({
        parsed,
        bufferIdsByPath,
        fileName: input.fileName,
    });

    try {
        // The decoded PCM travels beside the project data rather than inside
        // it: `projectData.audioBuffers` is the base64 shape a `.sourdaw` file
        // carries, and nothing here needs to survive JSON (ADR 0013).
        const ok = await applyImportedProjectData({
            data: projectData,
            decodedAudioBuffers: audioBuffers,
            shouldProceed,
            transaction,
        });
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
