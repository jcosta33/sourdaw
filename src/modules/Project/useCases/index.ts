// Project/useCases — public contract surface for cross-module project access.
export { newProject } from './projectPersistence/newProject';
export { saveProject } from './projectPersistence/saveProject/saveProject';
export { loadProject } from './projectPersistence/loadProject';
export { renameProject } from './projectPersistence/saveProject/renameProject';
export { importSclFile } from './importSclFile';
export { pickFiles } from './fileDialog';
export { createFromTemplate } from './projectTemplates/templateDefinitions/createFromTemplate';
export { getTemplates } from './projectTemplates/templateDefinitions/getTemplates';

export { exportProjectFile } from './projectPersistence/fileIO/exportProjectFile';
export { pickAndImportProjectFile } from './projectPersistence/fileIO/pickAndImportProjectFile';

export { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';
export { getSongStructureHandlers } from './getSongStructureHandlers';
export { getVersionControlHandlers } from './getVersionControlHandlers';
