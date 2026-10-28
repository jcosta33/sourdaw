import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { isHydratableProjectData } from '../helpers/isHydratableProjectData';
import { clearLastProjectDirectoryBinding } from '../../../repositories/project/projectDirectoryBinding';
import { normalizeLegacyProjectData } from '../helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../helpers/replaceProjectData';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';

type ApplyImportedProjectDataInput = {
    data: unknown;
    /** Buffers an importer already decoded, keyed by buffer id. Interchange
     * formats that carry their own audio assets hand the AudioBuffers over
     * directly instead of encoding them into the project snapshot. */
    decodedAudioBuffers?: Record<string, AudioBuffer>;
    /** The caller keeps this true only while the user still wants this replacement. */
    shouldProceed?: () => boolean;
    transaction?: ProjectLoadTransaction;
};

export async function applyImportedProjectData({
    data,
    decodedAudioBuffers,
    shouldProceed,
    transaction,
}: ApplyImportedProjectDataInput): Promise<boolean> {
    const normalizedData = normalizeLegacyProjectData(data);
    if (!isHydratableProjectData(normalizedData)) {
        return false;
    }

    const result = await replaceProjectData({
        context: 'applyImportedProjectData',
        data: normalizedData,
        decodedAudioBuffers,
        shouldProceed,
        transaction: transaction ?? runProjectLoadTransaction(),
    });
    if (result.status !== 'committed') {
        return false;
    }
    try {
        await clearLastProjectDirectoryBinding(normalizedData.meta.projectId);
    } catch (error) {
        logger.warn('Previous project folder binding could not be cleared:', error);
        notifyUser('Project imported, but this browser could not update its startup folder.', 'warning');
    }
    return true;
}
