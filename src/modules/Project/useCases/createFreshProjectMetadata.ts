import { createDefaultProductionBrief } from '../models/ProductionBrief';
import { createProjectId } from '../models/ProjectData';
import { type ProjectStoreState } from '../stores/projectStore';

type CreateFreshProjectMetadataInput = {
    name: string;
    loading: boolean;
    initialized: boolean;
    keyRoot?: number;
    scaleName?: string;
};

/** Project-owned creation boundary for metadata that starts a new project authority. */
export function createFreshProjectMetadata(input: CreateFreshProjectMetadataInput): ProjectStoreState {
    const createdAt = Date.now();
    return {
        projectId: createProjectId(),
        name: input.name,
        createdAt,
        updatedAt: createdAt,
        dirty: false,
        loading: input.loading,
        identityMigrationPending: false,
        keyRoot: input.keyRoot ?? 0,
        scaleName: input.scaleName ?? 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
        },
        productionBrief: createDefaultProductionBrief(createdAt),
        initialized: input.initialized,
    };
}
