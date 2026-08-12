// Project/useCases — public contract surface for cross-module project access.
export { newProject } from './projectPersistence/newProject';
export { captureProjectTransitionAuthority } from './projectPersistence/captureProjectTransitionAuthority';
export { saveProject } from './projectPersistence/saveProject/saveProject';
export { markDirty } from './projectPersistence/saveProject/markDirty';
export { initGrooveTemplateDirtyTracking } from './projectPersistence/saveProject/initGrooveTemplateDirtyTracking';
export { initProjectDirtyTracking } from './projectPersistence/saveProject/initProjectDirtyTracking';
export { loadProject } from './projectPersistence/loadProject';
export { migrateLegacyProjectSnapshots } from './projectPersistence/migrateLegacyProjectSnapshots';
export { setProjectIdentityTransitionDependencies } from './projectPersistence/projectIdentityTransitionDependencies';
export { renameProject } from './projectPersistence/saveProject/renameProject';
export { importSclFile } from './importSclFile';
export { finishProjectLoading } from './finishProjectLoading';
export { setProjectKeyRoot } from './setProjectKeyRoot';
export { setProjectScaleName } from './setProjectScaleName';
export { pickFiles } from './fileDialog';
export { createFromTemplate } from './projectTemplates/templateDefinitions/createFromTemplate';
export { getTemplates } from './projectTemplates/templateDefinitions/getTemplates';
export { getPreviewLoop } from './projectTemplates/templatePreviews/previewLoops';
export { getProjectHandlers } from './getProjectHandlers';
export { doesProductionBriefAllowActionBatch } from './doesProductionBriefAllowActionBatch';

export { exportProjectFile } from './projectPersistence/fileIO/exportProjectFile';
export { pickAndImportProjectFile } from './projectPersistence/fileIO/pickAndImportProjectFile';

export { buildProjectData } from './projectPersistence/fileIO/buildProjectData'; // interchange contract (ADR 0011)
export { applyImportedProjectData } from './projectPersistence/fileIO/applyImportedProjectData'; // interchange contract (ADR 0011)
export { runProjectLoadTransaction } from './projectPersistence/helpers/runProjectLoadTransaction'; // interchange contract (ADR 0011)

export { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';

export { getRecentProjects } from './recentProjects/helpers';
export { loadRecentProject } from './recentProjects/loadRecentProject';

export { isNativeProjectRuntimeAvailable } from './isNativeProjectRuntimeAvailable'; // export-runtime check (ADR 0011 W4)
