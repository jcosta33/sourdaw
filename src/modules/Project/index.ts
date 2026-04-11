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

export { exportProjectFile } from './useCases/projectPersistence/fileIO/exportProjectFile';
export { importProjectFile, importProjectFromNativePath, pickAndImportProjectFile } from './useCases/projectPersistence/fileIO/pickAndImportProjectFile';

export { verifyAudioBufferReferences } from './useCases/projectPersistence/helpers/verifyAudioBufferReferences';

// useCases/projectPersistence/loadProject.ts
export { loadProject } from './useCases/projectPersistence/loadProject';

// useCases/projectPersistence/newProject.ts
export { newProject } from './useCases/projectPersistence/newProject';

export { saveProject } from './useCases/projectPersistence/saveProject/saveProject';
export { renameProject } from './useCases/projectPersistence/saveProject/renameProject';
export { markDirty } from './useCases/projectPersistence/saveProject/markDirty';

export { getTemplates } from './useCases/projectTemplates/templateDefinitions/getTemplates';
export { createFromTemplate } from './useCases/projectTemplates/templateDefinitions/createFromTemplate';

// useCases/getSongStructureHandlers.ts
export { getSongStructureHandlers } from './useCases/getSongStructureHandlers';

// useCases/getVersionControlHandlers.ts
export { getVersionControlHandlers } from './useCases/getVersionControlHandlers';
