import { logger } from '#/infra/logger/appLogger';

import { type MergeResult } from '../../models/CrdtDocumentTypes';
import { persistCrdtProject } from '../persistCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';
import { decodeSdawFile } from '../sdawFileFormat/decodeSdawFile';

import { detectImportDecision } from './detectImportDecision';
import { mergeDocumentBundleFromRepo } from './helpers';

/**
 * Outcome of importing a `.sdaw` file. Discriminated so callers can tell the
 * user's legitimate "open separately" decision apart from a genuine failure —
 * both of which previously collapsed to a `null` return.
 */
export type ImportSdawResult =
    | { status: 'merged'; result: MergeResult }
    | { status: 'separate' }
    | { status: 'error'; error: unknown };

export async function importSdawFile(file: File): Promise<ImportSdawResult> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const bundle = decodeSdawFile(bytes);

        const decision = detectImportDecision(bundle);

        if (decision === 'separate') {
            return { status: 'separate' };
        }

        const result = await mergeDocumentBundleFromRepo(bundle);
        projectCrdtToStores();

        await persistCrdtProject();
        return { status: 'merged', result };
    } catch (error) {
        logger.warn('[CrdtMerge] Failed to import .sdaw file:', error);
        return { status: 'error', error };
    }
}
