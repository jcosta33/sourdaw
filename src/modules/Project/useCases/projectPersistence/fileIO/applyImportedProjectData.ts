import { isHydratableProjectData } from '../helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../helpers/normalizeLegacyProjectData';
import { replaceProjectData } from '../helpers/replaceProjectData';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';

type ApplyImportedProjectDataInput = {
    data: unknown;
    transaction?: ProjectLoadTransaction;
};

export async function applyImportedProjectData({ data, transaction }: ApplyImportedProjectDataInput): Promise<boolean> {
    const normalizedData = normalizeLegacyProjectData(data);
    if (!isHydratableProjectData(normalizedData)) {
        return false;
    }

    const result = await replaceProjectData({
        context: 'applyImportedProjectData',
        data: normalizedData,
        transaction: transaction ?? runProjectLoadTransaction(),
    });
    return result.status === 'committed';
}
