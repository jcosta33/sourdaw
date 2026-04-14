import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';
import { handleAddAutomationLane } from '../handlers/workspace/handleAddAutomationLane';
import { handleAddAutomationPoint } from '../handlers/workspace/handleAddAutomationPoint';
import { handleAddMarker } from '../handlers/workspace/handleAddMarker';
import { handleAddSection } from '../handlers/workspace/handleAddSection';
import { handleCloseMixer } from '../handlers/workspace/handleCloseMixer';
import { handleExportMidi } from '../handlers/workspace/handleExportMidi';
import { handleExportProject } from '../handlers/workspace/handleExportProject';
import { handleHumanizeNotes } from '../handlers/workspace/handleHumanizeNotes';
import { handleImportAudioFile } from '../handlers/workspace/handleImportAudioFile';
import { handleImportMidiFile } from '../handlers/workspace/handleImportMidiFile';
import { handleInvertNotes } from '../handlers/workspace/handleInvertNotes';
import { handleNewProject } from '../handlers/workspace/handleNewProject';
import { handleOpenMixer } from '../handlers/workspace/handleOpenMixer';
import { handleQuantizeNoteLengths } from '../handlers/workspace/handleQuantizeNoteLengths';
import { handleQuantizeNotes } from '../handlers/workspace/handleQuantizeNotes';
import { handleRemoveAutomationPoint } from '../handlers/workspace/handleRemoveAutomationPoint';
import { handleRemoveMarker } from '../handlers/workspace/handleRemoveMarker';
import { handleRemoveSection } from '../handlers/workspace/handleRemoveSection';
import { handleRenameSection } from '../handlers/workspace/handleRenameSection';
import { handleRetrogradeNotes } from '../handlers/workspace/handleRetrogradeNotes';
import { handleSaveProject } from '../handlers/workspace/handleSaveProject';
import { handleScaleAllVelocities } from '../handlers/workspace/handleScaleAllVelocities';
import { handleScaleVelocities } from '../handlers/workspace/handleScaleVelocities';
import { handleSetAllVelocities } from '../handlers/workspace/handleSetAllVelocities';
import { handleSetEditingTool } from '../handlers/workspace/handleSetEditingTool';
import { handleSetMarqueeSelection } from '../handlers/workspace/handleSetMarqueeSelection';
import { handleSetMarkerColor } from '../handlers/workspace/handleSetMarkerColor';
import { handleSetSnapValue } from '../handlers/workspace/handleSetSnapValue';
import { handleSetWorkspaceMode } from '../handlers/workspace/handleSetWorkspaceMode';
import { handleToggleChatPanel } from '../handlers/workspace/handleToggleChatPanel';
import { handleToggleInspector } from '../handlers/workspace/handleToggleInspector';
import { handleToggleSidebar } from '../handlers/workspace/handleToggleSidebar';
import { handleTransposeNotes } from '../handlers/workspace/handleTransposeNotes';
import { handleZoomToFit } from '../handlers/workspace/handleZoomToFit';
import { handleZoomToSelection } from '../handlers/workspace/handleZoomToSelection';

type WorkspaceAppAction =
    | Extract<AppAction, { type: 'setWorkspaceMode' }>
    | Extract<AppAction, { type: 'openMixer' }>
    | Extract<AppAction, { type: 'closeMixer' }>
    | Extract<AppAction, { type: 'toggleSidebar' }>
    | Extract<AppAction, { type: 'toggleInspector' }>
    | Extract<AppAction, { type: 'toggleChatPanel' }>
    | Extract<AppAction, { type: 'setEditingTool' }>
    | Extract<AppAction, { type: 'setMarqueeSelection' }>
    | Extract<AppAction, { type: 'addMarker' }>
    | Extract<AppAction, { type: 'removeMarker' }>
    | Extract<AppAction, { type: 'setMarkerColor' }>
    | Extract<AppAction, { type: 'addSection' }>
    | Extract<AppAction, { type: 'removeSection' }>
    | Extract<AppAction, { type: 'renameSection' }>
    | Extract<AppAction, { type: 'addAutomationLane' }>
    | Extract<AppAction, { type: 'addAutomationPoint' }>
    | Extract<AppAction, { type: 'removeAutomationPoint' }>
    | Extract<AppAction, { type: 'quantizeNotes' }>
    | Extract<AppAction, { type: 'transposeNotes' }>
    | Extract<AppAction, { type: 'humanizeNotes' }>
    | Extract<AppAction, { type: 'invertNotes' }>
    | Extract<AppAction, { type: 'retrogradeNotes' }>
    | Extract<AppAction, { type: 'quantizeNoteLengths' }>
    | Extract<AppAction, { type: 'scaleVelocities' }>
    | Extract<AppAction, { type: 'scaleAllVelocities' }>
    | Extract<AppAction, { type: 'setAllVelocities' }>
    | Extract<AppAction, { type: 'importMidiFile' }>
    | Extract<AppAction, { type: 'setSnapValue' }>
    | Extract<AppAction, { type: 'zoomToFit' }>
    | Extract<AppAction, { type: 'zoomToSelection' }>
    | Extract<AppAction, { type: 'exportProject' }>
    | Extract<AppAction, { type: 'saveProject' }>
    | Extract<AppAction, { type: 'newProject' }>
    | Extract<AppAction, { type: 'importAudioFile' }>
    | Extract<AppAction, { type: 'exportMidi' }>;

export type WorkspaceHandlersMap = {
    [Action in WorkspaceAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges Workspace \`ActionHandler\` maps for Command. Does **not** call \`createHandler\` here.
 */
export function getWorkspaceHandlers(): WorkspaceHandlersMap {
    return {
        setWorkspaceMode: handleSetWorkspaceMode,
        openMixer: handleOpenMixer,
        closeMixer: handleCloseMixer,
        toggleSidebar: handleToggleSidebar,
        toggleInspector: handleToggleInspector,
        toggleChatPanel: handleToggleChatPanel,
        setEditingTool: handleSetEditingTool,
        setMarqueeSelection: handleSetMarqueeSelection,
        addMarker: handleAddMarker,
        removeMarker: handleRemoveMarker,
        setMarkerColor: handleSetMarkerColor,
        addSection: handleAddSection,
        removeSection: handleRemoveSection,
        renameSection: handleRenameSection,
        addAutomationLane: handleAddAutomationLane,
        addAutomationPoint: handleAddAutomationPoint,
        removeAutomationPoint: handleRemoveAutomationPoint,
        quantizeNotes: handleQuantizeNotes,
        transposeNotes: handleTransposeNotes,
        humanizeNotes: handleHumanizeNotes,
        invertNotes: handleInvertNotes,
        retrogradeNotes: handleRetrogradeNotes,
        quantizeNoteLengths: handleQuantizeNoteLengths,
        scaleVelocities: handleScaleVelocities,
        scaleAllVelocities: handleScaleAllVelocities,
        setAllVelocities: handleSetAllVelocities,
        importMidiFile: handleImportMidiFile,
        setSnapValue: handleSetSnapValue,
        zoomToFit: handleZoomToFit,
        zoomToSelection: handleZoomToSelection,
        exportProject: handleExportProject,
        saveProject: handleSaveProject,
        newProject: handleNewProject,
        importAudioFile: handleImportAudioFile,
        exportMidi: handleExportMidi,
    };
}
