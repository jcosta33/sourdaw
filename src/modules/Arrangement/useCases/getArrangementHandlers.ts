import { handleCreateAdjustmentLayer } from '../handlers/batchFeature/handleCreateAdjustmentLayer';
import { handleCreateCompGroup } from '../handlers/batchFeature/handleCreateCompGroup';
import { handleSearchSamples } from '../handlers/batchFeature/handleSearchSamples';
import { clipHandlers } from '../handlers/clip/clipHandlers';
import { handleUnfreezeTrack } from '../handlers/track/unfreezeTrack';
import { handleFlattenTrack } from '../handlers/track/flattenTrack';
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
import { handleSetMidiOutput } from '../handlers/track/handleSetMidiOutput';
import { handleClearMidiOutput } from '../handlers/track/handleClearMidiOutput';
import { handleSetTrackPan } from '../handlers/track/handleSetTrackPan';
import { handleSoloTrack } from '../handlers/track/soloTrack';
import { handleToggleSoloSafe } from '../handlers/track/toggleSoloSafe';
import { handleUngroupTracks } from '../handlers/track/ungroupTracks';
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
import { handleFitClipToBeats } from '../handlers/clipStretch/handleFitClipToBeats';
import { handleSetClipStretchMode } from '../handlers/clipStretch/handleSetClipStretchMode';
import { handleSetClipStretchRatio } from '../handlers/clipStretch/handleSetClipStretchRatio';
import { handleLoadPreset } from '../handlers/preset/handleLoadPreset';
import { handleSavePreset } from '../handlers/preset/handleSavePreset';
import { handleRestoreClip } from '../handlers/restore/handleRestoreClip';
import { handleRestoreTrack } from '../handlers/restore/handleRestoreTrack';
import { handleAddDevice } from '../handlers/device/handleAddDevice';
import { handleLoadExternalPlugin } from '../handlers/device/handleLoadExternalPlugin';
import { handleAddSend } from '../handlers/device/handleAddSend';
import { handleAddSidechainRoute } from '../handlers/device/handleAddSidechainRoute';
import { handleBypassDevice } from '../handlers/device/handleBypassDevice';
import { handleRemoveDevice } from '../handlers/device/handleRemoveDevice';
import { handleRemoveSend } from '../handlers/device/handleRemoveSend';
import { handleRemoveSidechainRoute } from '../handlers/device/handleRemoveSidechainRoute';
import { handleSetDeviceParameter } from '../handlers/device/handleSetDeviceParameter';
import { handleSetSend } from '../handlers/device/handleSetSend';
import { handleAddMarker } from '../handlers/marker/handleAddMarker';
import { handleAddSection } from '../handlers/marker/handleAddSection';
import { handleRemoveMarker } from '../handlers/marker/handleRemoveMarker';
import { handleRemoveSection } from '../handlers/marker/handleRemoveSection';
import { handleRenameSection } from '../handlers/marker/handleRenameSection';
import { handleSetMarkerColor } from '../handlers/marker/handleSetMarkerColor';
import { handleGenerateAllTransitions } from '../handlers/newFeature/handleGenerateAllTransitions';
import { handleGenerateFill } from '../handlers/newFeature/handleGenerateFill';
import { handleClearScratchPad } from '../handlers/scratchPad/handleClearScratchPad';
import { handleCommitScratchPad } from '../handlers/scratchPad/handleCommitScratchPad';
import { handleArmTrack } from '../handlers/track/armTrack';
import { handleBounceInPlace } from '../handlers/track/bounceInPlace';
import { handleBounceToNewTrack } from '../handlers/track/bounceToNewTrack';
import { handleClearSolos } from '../handlers/track/clearSolos';
import { handleCreateFolder } from '../handlers/track/createFolder';
import { handleDisableTrack } from '../handlers/track/disableTrack';
import { handleDuplicateTrack } from '../handlers/track/duplicateTrack';
import { handleFoldTrack } from '../handlers/track/foldTrack';
import { handleFreezeTrack } from '../handlers/track/freezeTrack';
import { handleAddTrack } from '../handlers/track/handleAddTrack';
import { handleConsolidateAllTracks } from '../handlers/track/handleConsolidateAllTracks';
import { handleCreateBus } from '../handlers/track/handleCreateBus';

/**
 * Merges Arrangement handler maps for Command. Does **not** call `createHandler` here.
 *
 * Return type is inferred — TypeScript builds the precise object literal type
 * where every entry keeps its `ActionHandler<Extract<AppAction, …>>` shape.
 */
export function getArrangementHandlers() {
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
        flattenTrack: handleFlattenTrack,
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
        setMidiOutput: handleSetMidiOutput,
        clearMidiOutput: handleClearMidiOutput,
        setAutomationMode: handleSetAutomationMode,
        foldTrack: handleFoldTrack,
        groupTracks: handleGroupTracks,
        ungroupTracks: handleUngroupTracks,
        toggleSoloSafe: handleToggleSoloSafe,
        setTrackNotes: handleSetTrackNotes,
        setTrackInput: handleSetTrackInput,
        clearSolos: handleClearSolos,
        zoomTracksVertical: handleZoomTracksVertical,
        addMarker: handleAddMarker,
        removeMarker: handleRemoveMarker,
        setMarkerColor: handleSetMarkerColor,
        addSection: handleAddSection,
        removeSection: handleRemoveSection,
        renameSection: handleRenameSection,
        clearScratchPad: handleClearScratchPad,
        commitScratchPad: handleCommitScratchPad,
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
        setClipStretchMode: handleSetClipStretchMode,
        setClipStretchRatio: handleSetClipStretchRatio,
        fitClipToBeats: handleFitClipToBeats,
        loadPreset: handleLoadPreset,
        savePreset: handleSavePreset,
        restoreTrack: handleRestoreTrack,
        restoreClip: handleRestoreClip,
        addDevice: handleAddDevice,
        loadExternalPlugin: handleLoadExternalPlugin,
        bypassDevice: handleBypassDevice,
        removeDevice: handleRemoveDevice,
        setDeviceParameter: handleSetDeviceParameter,
        setSend: handleSetSend,
        addSend: handleAddSend,
        removeSend: handleRemoveSend,
        addSidechainRoute: handleAddSidechainRoute,
        removeSidechainRoute: handleRemoveSidechainRoute,
        generateFill: handleGenerateFill,
        generateAllTransitions: handleGenerateAllTransitions,
        searchSamples: handleSearchSamples,
        createCompGroup: handleCreateCompGroup,
        createAdjustmentLayer: handleCreateAdjustmentLayer,
        ...clipHandlers,
    };
}
