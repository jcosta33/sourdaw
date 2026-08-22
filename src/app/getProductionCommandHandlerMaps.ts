import { getGenerationHandlers, getAiMidiHandlers } from '#/modules/AiGeneration/useCases';
import { getAiOrganizationHandlers } from '#/modules/AiRuntime/useCases';
import { getArrangementHandlers, getSongStructureHandlers } from '#/modules/Arrangement/useCases';
import { getAnalysisHandlers } from '#/modules/AudioAnalysis/useCases';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getRaveHandlers } from '#/modules/BrowserAi/useCases';
import { getCollaborationHandlers } from '#/modules/Collaboration/useCases';
import { getMacroHandlers, getUndoRedoHandlers, getUndoTreeHandlers } from '#/modules/Command/useCases';
import { getControlRoomHandlers } from '#/modules/ControlRoom/useCases';
import { getControlSurfaceHandlers } from '#/modules/ControlSurface/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getDawProjectHandlers } from '#/modules/DawInterchange/useCases';
import { getGrandBouleHandlers } from '#/modules/GrandBoule/useCases';
import { getPitchHandlers } from '#/modules/Knead/useCases';
import {
    getChordTrackHandlers,
    getMidiGrooveHandlers,
    getMidiNoteTransformHandlers,
    getPatternInstanceHandlers,
    getWebMidiInputHandlers,
} from '#/modules/MIDI/useCases';
import { getPluginHostHandlers } from '#/modules/PluginHost/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { getVersionControlHandlers } from '#/modules/ProjectVersioning/useCases';
import { getPunchRecordingHandlers } from '#/modules/PunchRecording/useCases';
import { getNodeViewHandlers } from '#/modules/Routing/useCases';
import { getSessionLauncherHandlers } from '#/modules/SessionLauncher/useCases';
import { getSetlistHandlers } from '#/modules/Setlist/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getWorkspaceHandlers, getScratchPadHandlers } from '#/modules/WorkspaceShell/useCases';

export function getProductionCommandHandlerMaps(input: { canMutateBranchMetadata: () => boolean }) {
    return [
        getArrangementHandlers(),
        getTransportHandlers(),
        getSessionLauncherHandlers(),
        getSetlistHandlers(),
        getPunchRecordingHandlers(),
        getWorkspaceHandlers(),
        getAutomationHandlers(),
        getAudioRenderingHandlers(),
        getGenerationHandlers(),
        getAnalysisHandlers(),
        getCollaborationHandlers(),
        getPluginHostHandlers(),
        getAiMidiHandlers(),
        getAiOrganizationHandlers(),
        getChordTrackHandlers(),
        getMidiNoteTransformHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: input.canMutateBranchMetadata }),
        getMidiGrooveHandlers(),
        getControlSurfaceHandlers(),
        getScratchPadHandlers(),
        getPatternInstanceHandlers(),
        getMacroHandlers(),
        getUndoRedoHandlers(),
        getUndoTreeHandlers(),
        getPitchHandlers(),
        getSongStructureHandlers(),
        getProjectHandlers(),
        getVersionControlHandlers(),
        getDawProjectHandlers(),
        getFinalFeatureHandlers(),
        getGrandBouleHandlers(),
        getNodeViewHandlers(),
        getWebMidiInputHandlers(),
        getRaveHandlers(),
        getControlRoomHandlers(),
    ] as const;
}
