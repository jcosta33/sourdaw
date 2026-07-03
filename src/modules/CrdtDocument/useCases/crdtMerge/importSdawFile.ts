import { logger } from '#/infra/logger/appLogger';

import { type MergeResult } from '../../models/CrdtDocumentTypes';
import { persistCrdtProject } from '../persistCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';
import { decodeSdawFile } from '../sdawFileFormat/decodeSdawFile';

import { detectImportDecision } from './detectImportDecision';
import { mergeDocumentBundleFromRepo } from './helpers';

export async function importSdawFile(file: File): Promise<MergeResult | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const bundle = decodeSdawFile(bytes);

        const decision = detectImportDecision(bundle);

        if (decision === 'separate') {
            return null;
        }

        const result = await mergeDocumentBundleFromRepo(bundle);
        projectCrdtToStores();

        await persistCrdtProject();
        return result;
    } catch (error) {
        logger.warn('[CrdtMerge] Failed to import .sdaw file:', error);
        return null;
    }
}
