import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { reconcileGrooveTemplateStateConflicts, type GrooveTemplateState } from '../models/GrooveTemplateState';

const DOC_PREFIX_ROOT = 'root';

export function createGrooveTemplateAutomergeStorage() {
    return createAutomergeStorage<GrooveTemplateState>(DOC_PREFIX_ROOT, 'grooveTemplates', {
        resolveConflicts: reconcileGrooveTemplateStateConflicts,
    });
}
