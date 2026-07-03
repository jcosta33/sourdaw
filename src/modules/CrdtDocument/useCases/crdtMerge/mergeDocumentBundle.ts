import { type DocumentBundle, type MergeResult } from '../../models/CrdtDocumentTypes';
import { persistCrdtProject } from '../persistCrdtProject';
import { projectCrdtToStores } from '../projection/projectProjection';

import { mergeDocumentBundleFromRepo } from './helpers';

export async function mergeDocumentBundle(bundle: DocumentBundle): Promise<MergeResult> {
    const result = await mergeDocumentBundleFromRepo(bundle);
    projectCrdtToStores();
    await persistCrdtProject();
    return result;
}
