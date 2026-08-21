import { adjustmentLayerHandlers } from '../handlers/batchFeature/adjustmentLayerHandlers';
import { handleDiscardCreatedCompGroup } from '../handlers/batchFeature/discardCreatedCompGroup';
import { handleCreateCompGroup } from '../handlers/batchFeature/handleCreateCompGroup';
import { handleSearchSamples } from '../handlers/batchFeature/handleSearchSamples';
import { clipHandlers } from '../handlers/clip/clipHandlers';
import { handleRestoreTimeOperationState } from '../handlers/clip/handleRestoreTimeOperationState';
import { handleRestoreTrackClipStates } from '../handlers/clip/handleRestoreTrackClipStates';
import { handleFitClipToBeats } from '../handlers/clipStretch/handleFitClipToBeats';
import { handleRestoreClipStretchState } from '../handlers/clipStretch/handleRestoreClipStretchState';
import { handleSetClipStretchMode } from '../handlers/clipStretch/handleSetClipStretchMode';
import { handleSetClipStretchRatio } from '../handlers/clipStretch/handleSetClipStretchRatio';
import { handleAddDevice } from '../handlers/device/handleAddDevice';
import { handleAddSend } from '../handlers/device/handleAddSend';
import { handleAddSidechainRoute } from '../handlers/device/handleAddSidechainRoute';
import { handleBypassDevice } from '../handlers/device/handleBypassDevice';
import { handleLoadExternalPlugin } from '../handlers/device/handleLoadExternalPlugin';
import { handleRemoveDevice } from '../handlers/device/handleRemoveDevice';
import { handleRemoveSend } from '../handlers/device/handleRemoveSend';
import { handleRemoveSidechainRoute } from '../handlers/device/handleRemoveSidechainRoute';
import { handleReorderDevices } from '../handlers/device/handleReorderDevices';
import { handleRestoreDevice } from '../handlers/device/handleRestoreDevice';
import { handleSetDeviceParameter } from '../handlers/device/handleSetDeviceParameter';
import { handleSetDeviceState } from '../handlers/device/handleSetDeviceState';
import { handleSetExternalPluginState } from '../handlers/device/handleSetExternalPluginState';
import { handleSetSend } from '../handlers/device/handleSetSend';
import { handleAddMarker } from '../handlers/marker/handleAddMarker';
import { handleAddSection } from '../handlers/marker/handleAddSection';
import { handleRemoveMarker } from '../handlers/marker/handleRemoveMarker';
import { handleRemoveSection } from '../handlers/marker/handleRemoveSection';
import { handleRenameSection } from '../handlers/marker/handleRenameSection';
import { handleSetMarkerColor } from '../handlers/marker/handleSetMarkerColor';
import { handleLoadPreset, handleRestorePresetDeviceChain } from '../handlers/preset/handleLoadPreset';
import { handleSavePreset } from '../handlers/preset/handleSavePreset';
import { handleRestoreClip } from '../handlers/restore/handleRestoreClip';
import { handleRestoreTrack } from '../handlers/restore/handleRestoreTrack';
import { handleClearScratchPad } from '../handlers/scratchPad/handleClearScratchPad';
import { handleCommitScratchPad } from '../handlers/scratchPad/handleCommitScratchPad';
import { handleRestoreScratchPadState } from '../handlers/scratchPad/handleRestoreScratchPadState';
import { handleDeleteTrackTemplate } from '../handlers/template/handleDeleteTrackTemplate';
import { handleLoadTrackTemplate } from '../handlers/template/handleLoadTrackTemplate';
import { handleSaveTrackTemplate } from '../handlers/template/handleSaveTrackTemplate';
import { handleArmTrack } from '../handlers/track/armTrack';
import { handleBounceInPlace } from '../handlers/track/bounceInPlace';
import { handleBounceToNewTrack } from '../handlers/track/bounceToNewTrack';
import { handleClearSolos } from '../handlers/track/clearSolos';
import { handleCreateFolder } from '../handlers/track/createFolder';
import { handleDisableTrack } from '../handlers/track/disableTrack';
import { handleDiscardCreatedTrack } from '../handlers/track/discardCreatedTrack';
import { handleDiscardCreatedTracks } from '../handlers/track/discardCreatedTracks';
import { handleDuplicateTrack } from '../handlers/track/duplicateTrack';
import { handleFlattenTrack } from '../handlers/track/flattenTrack';
import { handleFoldTrack } from '../handlers/track/foldTrack';
import { handleFreezeTrack } from '../handlers/track/freezeTrack';
import { handleGroupTracks } from '../handlers/track/groupTracks';
import { handleAddTrack } from '../handlers/track/handleAddTrack';
import { handleClearMidiOutput } from '../handlers/track/handleClearMidiOutput';
import { handleConsolidateAllTracks } from '../handlers/track/handleConsolidateAllTracks';
import { handleCreateBus } from '../handlers/track/handleCreateBus';
import { handleDiscardImportedStemSet, handleImportStemSet } from '../handlers/track/handleImportStemSet';
import { handleRemoveAllTracks } from '../handlers/track/handleRemoveAllTracks';
import { handleRemoveTrack } from '../handlers/track/handleRemoveTrack';
import { handleSetMidiOutput } from '../handlers/track/handleSetMidiOutput';
import { handleSetTrackColor } from '../handlers/track/handleSetTrackColor';
import { handleSetTrackGain } from '../handlers/track/handleSetTrackGain';
import { handleSetTrackInput } from '../handlers/track/handleSetTrackInput';
import { handleSetTrackPan } from '../handlers/track/handleSetTrackPan';
import { handleHideTrack } from '../handlers/track/hideTrack';
import { handleMuteTrack } from '../handlers/track/muteTrack';
import { handleRenameTrack } from '../handlers/track/renameTrack';
import { handleReorderTrack } from '../handlers/track/reorderTrack';
import { handleRestoreFreezeState } from '../handlers/track/restoreFreezeState';
import { handleRestoreMidiOutput } from '../handlers/track/restoreMidiOutput';
import { handleRestoreSoloSafe } from '../handlers/track/restoreSoloSafe';
import { handleRestoreTrackDisabled } from '../handlers/track/restoreTrackDisabled';
import { handleRestoreTrackGroupMemberships } from '../handlers/track/restoreTrackGroupMemberships';
import { handleRestoreTrackHeights } from '../handlers/track/restoreTrackHeights';
import { handleRestoreTrackInput } from '../handlers/track/restoreTrackInput';
import { handleRestoreTracks } from '../handlers/track/restoreTracks';
import { handleRestoreTrackSoloStates } from '../handlers/track/restoreTrackSoloStates';
import { handleSelectTrack } from '../handlers/track/selectTrack';
import { handleSetAutomationMode } from '../handlers/track/setAutomationMode';
import { handleSetSoloSafe } from '../handlers/track/setSoloSafe';
import { handleSetTrackHeight } from '../handlers/track/setTrackHeight';
import { handleSetTrackNotes } from '../handlers/track/setTrackNotes';
import { handleSetTrackOutput } from '../handlers/track/setTrackOutput';
import { handleSoloTrack } from '../handlers/track/soloTrack';
import { handleToggleSoloSafe } from '../handlers/track/toggleSoloSafe';
import { handleUnfreezeTrack } from '../handlers/track/unfreezeTrack';
import { handleUngroupTracks } from '../handlers/track/ungroupTracks';
import { handleZoomTracksVertical } from '../handlers/track/zoomTracksVertical';
import { handleCreateTrackAlternative } from '../handlers/trackAlternative/handleCreateTrackAlternative';
import { handleDeleteTrackAlternative } from '../handlers/trackAlternative/handleDeleteTrackAlternative';
import { handleRenameTrackAlternative } from '../handlers/trackAlternative/handleRenameTrackAlternative';
import { handleRestoreTrackAlternativeState } from '../handlers/trackAlternative/handleRestoreTrackAlternativeState';
import { handleSwitchTrackAlternative } from '../handlers/trackAlternative/handleSwitchTrackAlternative';
import { handleAssignToVca } from '../handlers/vca/handleAssignToVca';
import { handleCreateVcaGroup } from '../handlers/vca/handleCreateVcaGroup';
import { handleRemoveFromVca } from '../handlers/vca/handleRemoveFromVca';
import { handleRestoreLegacyVcaState } from '../handlers/vca/handleRestoreLegacyVcaState';
import { handleSetVcaGain } from '../handlers/vca/handleSetVcaGain';

/**
 * Merges Arrangement handler maps for Command. Does **not** call `createHandler` here.
 *
 * Return type is inferred — TypeScript builds the precise object literal type
 * where every entry keeps its `ActionHandler<Extract<AppAction, …>>` shape.
 */
export function getArrangementHandlers() {
    return {
        importStemSet: handleImportStemSet,
        discardImportedStemSet: handleDiscardImportedStemSet,
        addTrack: handleAddTrack,
        removeTrack: handleRemoveTrack,
        removeAllTracks: handleRemoveAllTracks,
        renameTrack: handleRenameTrack,
        selectTrack: handleSelectTrack,
        muteTrack: handleMuteTrack,
        soloTrack: handleSoloTrack,
        setSoloSafe: handleSetSoloSafe,
        armTrack: handleArmTrack,
        freezeTrack: handleFreezeTrack,
        unfreezeTrack: handleUnfreezeTrack,
        flattenTrack: handleFlattenTrack,
        bounceInPlace: handleBounceInPlace,
        duplicateTrack: handleDuplicateTrack,
        discardCreatedTrack: handleDiscardCreatedTrack,
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
        restoreSoloSafe: handleRestoreSoloSafe,
        restoreTrackSoloStates: handleRestoreTrackSoloStates,
        restoreTrackDisabled: handleRestoreTrackDisabled,
        restoreMidiOutput: handleRestoreMidiOutput,
        restoreTrackInput: handleRestoreTrackInput,
        restoreFreezeState: handleRestoreFreezeState,
        restoreTrackGroupMemberships: handleRestoreTrackGroupMemberships,
        restoreTrackHeights: handleRestoreTrackHeights,
        restoreTracks: handleRestoreTracks,
        discardCreatedTracks: handleDiscardCreatedTracks,
        restoreTimeOperationState: handleRestoreTimeOperationState,
        restoreTrackClipStates: handleRestoreTrackClipStates,
        restoreScratchPadState: handleRestoreScratchPadState,
        discardCreatedCompGroup: handleDiscardCreatedCompGroup,
        restoreTrackAlternativeState: handleRestoreTrackAlternativeState,
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
        restoreLegacyVcaState: handleRestoreLegacyVcaState,
        setClipStretchMode: handleSetClipStretchMode,
        setClipStretchRatio: handleSetClipStretchRatio,
        restoreClipStretchState: handleRestoreClipStretchState,
        fitClipToBeats: handleFitClipToBeats,
        loadPreset: handleLoadPreset,
        restorePresetDeviceChain: handleRestorePresetDeviceChain,
        savePreset: handleSavePreset,
        restoreTrack: handleRestoreTrack,
        restoreClip: handleRestoreClip,
        addDevice: handleAddDevice,
        loadExternalPlugin: handleLoadExternalPlugin,
        bypassDevice: handleBypassDevice,
        removeDevice: handleRemoveDevice,
        reorderDevices: handleReorderDevices,
        restoreDevice: handleRestoreDevice,
        setDeviceParameter: handleSetDeviceParameter,
        setExternalPluginState: handleSetExternalPluginState,
        setDeviceState: handleSetDeviceState,
        setSend: handleSetSend,
        addSend: handleAddSend,
        removeSend: handleRemoveSend,
        addSidechainRoute: handleAddSidechainRoute,
        removeSidechainRoute: handleRemoveSidechainRoute,
        searchSamples: handleSearchSamples,
        createCompGroup: handleCreateCompGroup,
        ...adjustmentLayerHandlers,
        ...clipHandlers,
    };
}
