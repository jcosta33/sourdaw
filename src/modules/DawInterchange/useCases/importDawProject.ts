import { logger } from '#/infra/logger/appLogger';
import { applyImportedProjectData, runProjectLoadTransaction } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type DawProjectImportWarning } from './dawProjectTypes';
import { decodeDawProjectAssets } from './decodeDawProjectAssets';
import { mapToProjectData } from './mapToProjectData';
import { parseDawProject } from './parseDawProject';

export type ImportDawProjectInput = {
    buffer: ArrayBuffer;
    fileName: string;
    /** The caller keeps this true only while the user still wants this replacement. */
    shouldProceed?: () => boolean;
};

export type ImportDawProjectResult = { ok: boolean; warnings: DawProjectImportWarning[] };
export type ImportDawProjectOutput = Promise<ImportDawProjectResult>;

function warningMessage(warning: DawProjectImportWarning, index: number, total: number): string {
    const subject = `${warning.sourceType} "${warning.name}" on "${warning.context}"`;
    let detail: string;
    if (warning.kind === 'unsupported-device') {
        detail = `${subject} was replaced with a gain device`;
    } else if (warning.kind === 'unsupported-device-settings') {
        detail = `Settings for ${subject} were not imported`;
    } else if (warning.kind === 'missing-audio') {
        detail = `Audio for ${subject} could not be loaded`;
    } else if (warning.handling === 'substituted') {
        detail = `${subject} was substituted`;
    } else {
        detail = `${subject} was not imported`;
    }
    return `DAWproject warning ${String(index + 1)}/${String(total)}: ${detail}. Dismiss to read the next warning.`;
}

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
        return { ok: false, warnings: [] };
    }

    const warnings = parsed.warnings?.slice() ?? [];

    const { audioBuffers, bufferIdsByPath, failedPaths } = await decodeDawProjectAssets({
        audioAssets: parsed.audioAssets,
        shouldContinue,
    });
    if (!shouldContinue()) {
        return { ok: false, warnings };
    }
    if (failedPaths.length > 0) {
        logger.warn(`[importDawProject] Failed to decode ${String(failedPaths.length)} audio asset(s)`, failedPaths);
    }

    const projectData = mapToProjectData({
        parsed,
        bufferIdsByPath,
        fileName: input.fileName,
        warnings,
    });
    warnings.sort((a, b) => a.sourceOrder - b.sourceOrder);

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
            for (const [index, warning] of warnings.entries()) {
                notifyUser(warningMessage(warning, index, warnings.length), 'warning');
            }
            notifyUser(`Imported ${parsed.meta.title || input.fileName} (${String(trackCount)} tracks)`, 'success');
        }
        return { ok, warnings };
    } catch (error) {
        notifyUser('Failed to apply imported DAWproject data', 'error');
        logger.warn('[importDawProject] apply failure', error);
        return { ok: false, warnings };
    }
}
