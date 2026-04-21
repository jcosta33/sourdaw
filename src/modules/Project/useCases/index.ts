// Project/useCases — public contract surface for cross-module project access.
export { newProject } from './projectPersistence/newProject';
export { saveProject } from './projectPersistence/saveProject/saveProject';
export { loadProject } from './projectPersistence/loadProject';
export { renameProject } from './projectPersistence/saveProject/renameProject';
export { importSclFile } from './importSclFile';
export { pickFiles } from './fileDialog';
export {
    createFromTemplate,
    getTemplates,
    previewLoops,
    getPreviewLoop,
    templatePreviewPlayer,
} from './projectTemplates/index';

export { exportProjectFile } from './projectPersistence/fileIO/exportProjectFile';
export { pickAndImportProjectFile } from './projectPersistence/fileIO/pickAndImportProjectFile';

export { importDawProject } from './dawProject/importDawProject';
export { pickAndImportDawProject } from './dawProject/pickAndImportDawProject';

export { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';
export { getSongStructureHandlers } from './getSongStructureHandlers';
export { getVersionControlHandlers } from './getVersionControlHandlers';
export { getDawProjectHandlers } from './getDawProjectHandlers';

export { getRecentProjects } from './recentProjects/helpers';
export { loadRecentProject } from './recentProjects/loadRecentProject';
