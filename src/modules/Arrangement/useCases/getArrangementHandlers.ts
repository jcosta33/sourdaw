import { type ActionHandler } from '#/modules/Command';
import { handleAddTrack } from '../handlers/track/handleAddTrack';
import { handleArmTrack } from '../handlers/track/armTrack';
import { handleBounceInPlace } from '../handlers/track/bounceInPlace';
import { handleBounceToNewTrack } from '../handlers/track/bounceToNewTrack';
import { handleClearSolos } from '../handlers/track/clearSolos';
import { handleConsolidateAllTracks } from '../handlers/track/handleConsolidateAllTracks';
import { handleCreateBus } from '../handlers/track/handleCreateBus';
import { handleCreateFolder } from '../handlers/track/createFolder';
import { handleDisableTrack } from '../handlers/track/disableTrack';
import { handleDuplicateTrack } from '../handlers/track/duplicateTrack';
import { handleFoldTrack } from '../handlers/track/foldTrack';
import { handleFreezeTrack } from '../handlers/track/freezeTrack';
import { handleGroupTracks } from '../handlers/track/groupTracks';
import { handleHideTrack } from '../handlers/track/hideTrack';
import { handleMuteTrack } from '../handlers/track/muteTrack';
import { handleRemoveAllTracks } from '../handlers/track/handleRemoveAllTracks';
import { handleRemoveTrack } from '../handlers/track/handleRemoveTrack';
import { handleRenameTrack } from '../handlers/track/renameTrack';
import { handleReorderTrack } from '../handlers/track/reorderTrack';
import { handleSelectTrack } from '../handlers/track/selectTrack';
import { handleSetAutomationMode } from '../handlers/track/setAutomationMode';
import { handleSetTrackColor } from '../handlers/track/handleSetTrackColor';
import { handleSetTrackGain } from '../handlers/track/handleSetTrackGain';
import { handleSetTrackHeight } from '../handlers/track/setTrackHeight';
import { handleSetTrackInput } from '../handlers/track/handleSetTrackInput';
import { handleSetTrackNotes } from '../handlers/track/setTrackNotes';
import { handleSetTrackOutput } from '../handlers/track/setTrackOutput';
import { handleSetTrackPan } from '../handlers/track/handleSetTrackPan';
import { handleSoloTrack } from '../handlers/track/soloTrack';
import { handleToggleSoloSafe } from '../handlers/track/toggleSoloSafe';
import { handleUngroupTracks } from '../handlers/track/ungroupTracks';
import { handleUnfreezeTrack } from '../handlers/track/unfreezeTrack';
import { handleZoomTracksVertical } from '../handlers/track/zoomTracksVertical';
import { handleCreateTrackAlternative } from '../handlers/trackAlternative/handleCreateTrackAlternative';
import { handleDeleteTrackAlternative } from '../handlers/trackAlternative/handleDeleteTrackAlternative';
import { handleRenameTrackAlternative } from '../handlers/trackAlternative/handleRenameTrackAlternative';
import { handleSwitchTrackAlternative } from '../handlers/trackAlternative/handleSwitchTrackAlternative';
import { handleDeleteTrackTemplate } from '../handlers/template/handleDeleteTrackTemplate';
import { handleLoadTrackTemplate } from '../handlers/template/handleLoadTrackTemplate';
import { handleSaveTrackTemplate } from '../handlers/template/handleSaveTrackTemplate';
import { handleAssignToVca } from '../handlers/vca/handleAssignToVca';
import { handleCreateVcaGroup } from '../handlers/vca/handleCreateVcaGroup';
import { handleRemoveFromVca } from '../handlers/vca/handleRemoveFromVca';
import { handleSetVcaGain } from '../handlers/vca/handleSetVcaGain';
import { batchFeatureHandlers } from './batchFeatureHandlers';
import { clipHandlers } from './clipHandlers';
import { deviceHandlers } from './deviceHandlers';
import { newFeatureHandlers } from './newFeatureHandlers';
import { presetHandlers } from './presetHandlers';
import { restoreHandlers } from './restoreHandlers';
import { stretchHandlers } from './stretchHandlers';

/**
 * Merges Arrangement handler maps for Command. Does **not** call `createHandler` here.
 */
export function getArrangementHandlers(): Record<string, ActionHandler<any>> {
    return {
        addTrack: handleAddTrack,
        removeTrack: handleRemoveTrack,
        removeAllTracks: handleRemoveAllTracks,
        renameTrack: handleRenameTrack,
        selectTrack: handleSelectTrack,
        muteTrack: handleMuteTrack,
        soloTrack: handleSoloTrack,
        armTrack: handleArmTrack,
        freezeTrack: handleFreezeTrack,
        unfreezeTrack: handleUnfreezeTrack,
        bounceInPlace: handleBounceInPlace,
        duplicateTrack: handleDuplicateTrack,
        reorderTrack: handleReorderTrack,
        setTrackGain: handleSetTrackGain,
        setTrackPan: handleSetTrackPan,
        setTrackColor: handleSetTrackColor,
        createBus: handleCreateBus,
        createFolder: handleCreateFolder,
        hideTrack: handleHideTrack,
        disableTrack: handleDisableTrack,
        setTrackHeight: handleSetTrackHeight,
        setTrackOutput: handleSetTrackOutput,
        setAutomationMode: handleSetAutomationMode,
        foldTrack: handleFoldTrack,
        groupTracks: handleGroupTracks,
        ungroupTracks: handleUngroupTracks,
        toggleSoloSafe: handleToggleSoloSafe,
        setTrackNotes: handleSetTrackNotes,
        setTrackInput: handleSetTrackInput,
        clearSolos: handleClearSolos,
        zoomTracksVertical: handleZoomTracksVertical,
        consolidateAllTracks: handleConsolidateAllTracks,
        bounceToNewTrack: handleBounceToNewTrack,
        createTrackAlternative: handleCreateTrackAlternative,
        switchTrackAlternative: handleSwitchTrackAlternative,
        renameTrackAlternative: handleRenameTrackAlternative,
        deleteTrackAlternative: handleDeleteTrackAlternative,
        saveTrackTemplate: handleSaveTrackTemplate,
        loadTrackTemplate: handleLoadTrackTemplate,
        deleteTrackTemplate: handleDeleteTrackTemplate,
        createVcaGroup: handleCreateVcaGroup,
        assignToVca: handleAssignToVca,
        removeFromVca: handleRemoveFromVca,
        setVcaGain: handleSetVcaGain,
        ...clipHandlers,
        ...restoreHandlers,
        ...deviceHandlers,
        ...presetHandlers,
        ...stretchHandlers,
        ...newFeatureHandlers,
        ...batchFeatureHandlers,
    };
}
