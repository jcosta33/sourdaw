import { isHydratableProjectData } from '../helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../helpers/replaceProjectData';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';

type ApplyImportedProjectDataInput = {
    data: unknown;
    /** Buffers an importer already decoded, keyed by buffer id. Interchange
     * formats that carry their own audio assets hand the AudioBuffers over
     * directly instead of encoding them into the project snapshot. */
    decodedAudioBuffers?: Record<string, AudioBuffer>;
    transaction?: ProjectLoadTransaction;
};

export async function applyImportedProjectData({
    data,
    decodedAudioBuffers,
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
        transaction: transaction ?? runProjectLoadTransaction(),
    });
    return result.status === 'committed';
}
