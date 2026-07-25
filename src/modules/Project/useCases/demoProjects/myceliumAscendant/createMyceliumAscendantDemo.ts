import { batchStoreUpdates } from '#/infra/store/createStore';

import { projectStore } from '../../../stores/projectStore';
import { hydrateArrangementStoreFromProjectData } from '../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../../projectPersistence/helpers/isHydratableProjectData';

import { createMyceliumAscendantBlueprint } from './createMyceliumAscendantBlueprint';

export function createMyceliumAscendantDemo(): void {
    const { projectData } = createMyceliumAscendantBlueprint();
    if (!isHydratableProjectData(projectData)) {
        throw new Error('Mycelium Ascendant generated invalid project data');
    }

    batchStoreUpdates(() => {
        hydrateArrangementStoreFromProjectData({ data: projectData, preserveSavedArrangements: true });
        hydrateModuleStoresFromProjectData(projectData);
        projectStore.set({
            name: projectData.meta.name,
            createdAt: projectData.meta.createdAt,
            updatedAt: projectData.meta.updatedAt,
            dirty: false,
            loading: true,
            initialized: false,
            keyRoot: projectData.meta.keyRoot,
            scaleName: projectData.meta.scaleName,
            tuning: projectData.meta.tuning,
        });
    });
}
