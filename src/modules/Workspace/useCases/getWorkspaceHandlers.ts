import { handleCloseMixer } from '../handlers/workspace/handleCloseMixer';
import { handleExportProject } from '../handlers/workspace/handleExportProject';
import { handleImportAudioFile } from '../handlers/workspace/handleImportAudioFile';
import { handleImportMidiFile } from '../handlers/workspace/handleImportMidiFile';
import { handleNewProject } from '../handlers/workspace/handleNewProject';
import { handleOpenMixer } from '../handlers/workspace/handleOpenMixer';
import { handleOpenPreferencesDialog } from '../handlers/workspace/handleOpenPreferencesDialog';
import { handleSaveProject } from '../handlers/workspace/handleSaveProject';
import { handleSetEditingTool } from '../handlers/workspace/handleSetEditingTool';
import { handleSetMarqueeSelection } from '../handlers/workspace/handleSetMarqueeSelection';
import { handleSetSnapValue } from '../handlers/workspace/handleSetSnapValue';
import { handleSetWorkspaceMode } from '../handlers/workspace/handleSetWorkspaceMode';
import { handleToggleChatPanel } from '../handlers/workspace/handleToggleChatPanel';
import { handleToggleInspector } from '../handlers/workspace/handleToggleInspector';
import { handleToggleSidebar } from '../handlers/workspace/handleToggleSidebar';
import { handleZoomToFit } from '../handlers/workspace/handleZoomToFit';
import { handleZoomToSelection } from '../handlers/workspace/handleZoomToSelection';

export type WorkspaceHandlersMap = {
    closeMixer: typeof handleCloseMixer;
    exportProject: typeof handleExportProject;
    importAudioFile: typeof handleImportAudioFile;
    importMidiFile: typeof handleImportMidiFile;
    newProject: typeof handleNewProject;
    openMixer: typeof handleOpenMixer;
    openPreferencesDialog: typeof handleOpenPreferencesDialog;
    saveProject: typeof handleSaveProject;
    setEditingTool: typeof handleSetEditingTool;
    setMarqueeSelection: typeof handleSetMarqueeSelection;
    setSnapValue: typeof handleSetSnapValue;
    setWorkspaceMode: typeof handleSetWorkspaceMode;
    toggleChatPanel: typeof handleToggleChatPanel;
    toggleInspector: typeof handleToggleInspector;
    toggleSidebar: typeof handleToggleSidebar;
    zoomToFit: typeof handleZoomToFit;
    zoomToSelection: typeof handleZoomToSelection;
};

/**
 * Merges Workspace \`ActionHandler\` maps for Command. Does **not** call \`createHandler\` here.
 */
export function getWorkspaceHandlers(): WorkspaceHandlersMap {
    return {
        setWorkspaceMode: handleSetWorkspaceMode,
        openPreferencesDialog: handleOpenPreferencesDialog,
        openMixer: handleOpenMixer,
        closeMixer: handleCloseMixer,
        toggleSidebar: handleToggleSidebar,
        toggleInspector: handleToggleInspector,
        toggleChatPanel: handleToggleChatPanel,
        setEditingTool: handleSetEditingTool,
        setMarqueeSelection: handleSetMarqueeSelection,
        importMidiFile: handleImportMidiFile,
        setSnapValue: handleSetSnapValue,
        zoomToFit: handleZoomToFit,
        zoomToSelection: handleZoomToSelection,
        exportProject: handleExportProject,
        saveProject: handleSaveProject,
        newProject: handleNewProject,
        importAudioFile: handleImportAudioFile,
    };
}
