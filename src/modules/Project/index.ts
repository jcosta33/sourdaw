// presentations/views/ArrangementSelector.tsx
export { ArrangementSelector } from './presentations/views/ArrangementSelector';

// presentations/views/ExportDialog.tsx
export { ExportDialog } from './presentations/views/ExportDialog';

// presentations/views/RecentProjectsMenu.tsx
export { RecentProjectsMenu } from './presentations/views/RecentProjectsMenu';

// stores/arrangementStore.ts
export type { ArrangementStoreState } from './stores/arrangementStore';
export { arrangementStore, defaultArrangementId } from './stores/arrangementStore';

// stores/projectStore.ts
export type { ProjectStoreState } from './stores/projectStore';
export { projectStore } from './stores/projectStore';

// useCases/fileDialog.ts
export { pickFiles } from './useCases/fileDialog';

// useCases/projectPersistence/fileIO.ts
export { exportProjectFile, importProjectFile } from './useCases/projectPersistence/fileIO';

// useCases/projectPersistence/helpers.ts
export {
    clearUndoHistory,
    resetModuleStoresToDefault,
    hydrateModuleStoresFromProjectData,
    verifyAudioBufferReferences,
} from './useCases/projectPersistence/helpers';

// useCases/projectPersistence/loadProject.ts
export { loadProject } from './useCases/projectPersistence/loadProject';

// useCases/projectPersistence/newProject.ts
export { newProject } from './useCases/projectPersistence/newProject';

// useCases/projectPersistence/saveProject.ts
export { saveProject, renameProject, markDirty } from './useCases/projectPersistence/saveProject';

// useCases/projectTemplates/templateDefinitions.ts
export { getTemplates, createFromTemplate } from './useCases/projectTemplates/templateDefinitions';

// useCases/songStructureHandlers.ts
export { songStructureHandlers } from './useCases/songStructureHandlers';

// useCases/versionControlHandlers.ts
export { versionControlHandlers } from './useCases/versionControlHandlers';
