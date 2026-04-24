import { handleAddAdjustmentRegion } from '../handlers/batchFeature/handleAddAdjustmentRegion';
import { handleCreateAdjustmentLayer } from '../handlers/batchFeature/handleCreateAdjustmentLayer';
import { handleCreateCompGroup } from '../handlers/batchFeature/handleCreateCompGroup';
import { handleMoveAdjustmentRegion } from '../handlers/batchFeature/handleMoveAdjustmentRegion';
import { handleRemoveAdjustmentLayer } from '../handlers/batchFeature/handleRemoveAdjustmentLayer';
import { handleRemoveAdjustmentRegion } from '../handlers/batchFeature/handleRemoveAdjustmentRegion';
import { handleSetLayerAffectedTracks } from '../handlers/batchFeature/handleSetLayerAffectedTracks';
import { handleSetLayerFades } from '../handlers/batchFeature/handleSetLayerFades';
import { handleSetLayerInsertionIndex } from '../handlers/batchFeature/handleSetLayerInsertionIndex';
import { handleSetLayerMix } from '../handlers/batchFeature/handleSetLayerMix';
import { handleSetLayerParameter } from '../handlers/batchFeature/handleSetLayerParameter';
import { handleToggleAdjustmentLayer } from '../handlers/batchFeature/handleToggleAdjustmentLayer';
import { handleNextSetlistItem } from '../handlers/batchFeature/handleNextSetlistItem';
import { handlePreviousSetlistItem } from '../handlers/batchFeature/handlePreviousSetlistItem';
import { handleSearchSamples } from '../handlers/batchFeature/handleSearchSamples';
import { handleToggleLoopRecord } from '../handlers/batchFeature/handleToggleLoopRecord';
import { handleTogglePunchRecording } from '../handlers/batchFeature/handleTogglePunchRecording';
import { handleTriggerScene } from '../handlers/batchFeature/handleTriggerScene';
import { clipHandlers } from '../handlers/clip/clipHandlers';
import { handleFitClipToBeats } from '../handlers/clipStretch/handleFitClipToBeats';
import { handleSetClipStretchMode } from '../handlers/clipStretch/handleSetClipStretchMode';
import { handleSetClipStretchRatio } from '../handlers/clipStretch/handleSetClipStretchRatio';
import { handleAddDevice } from '../handlers/device/handleAddDevice';
import { handleAddSend } from '../handlers/device/handleAddSend';
import { handleAddSidechainRoute } from '../handlers/device/handleAddSidechainRoute';
import { handleBypassDevice } from '../handlers/device/handleBypassDevice';
import { handleDisableMpe } from '../handlers/device/handleDisableMpe';
import { handleEnableMpe } from '../handlers/device/handleEnableMpe';
import { handleGetLatencyReport } from '../handlers/device/handleGetLatencyReport';
import { handleRemoveDevice } from '../handlers/device/handleRemoveDevice';
import { handleRemoveSend } from '../handlers/device/handleRemoveSend';
import { handleRemoveSidechainRoute } from '../handlers/device/handleRemoveSidechainRoute';
import { handleSetDeviceParameter } from '../handlers/device/handleSetDeviceParameter';
import { handleSetSend } from '../handlers/device/handleSetSend';
import { handleCompareToReference } from '../handlers/newFeature/handleCompareToReference';
import { handleGenerateAllTransitions } from '../handlers/newFeature/handleGenerateAllTransitions';
import { handleGenerateFill } from '../handlers/newFeature/handleGenerateFill';
import { handleGetMentorTips } from '../handlers/newFeature/handleGetMentorTips';
import { handleSwitchMonitor } from '../handlers/newFeature/handleSwitchMonitor';
import { handleToggleControlRoomDim } from '../handlers/newFeature/handleToggleControlRoomDim';
import { handleToggleControlRoomMono } from '../handlers/newFeature/handleToggleControlRoomMono';
import { handleLoadPreset } from '../handlers/preset/handleLoadPreset';
import { handleSavePreset } from '../handlers/preset/handleSavePreset';
import { handleRestoreClip } from '../handlers/restore/handleRestoreClip';
import { handleRestoreTrack } from '../handlers/restore/handleRestoreTrack';
import { handleDeleteTrackTemplate } from '../handlers/template/handleDeleteTrackTemplate';
import { handleLoadTrackTemplate } from '../handlers/template/handleLoadTrackTemplate';
import { handleSaveTrackTemplate } from '../handlers/template/handleSaveTrackTemplate';
import { handleArmTrack } from '../handlers/track/armTrack';
import { handleBounceInPlace } from '../handlers/track/bounceInPlace';
import { handleBounceToNewTrack } from '../handlers/track/bounceToNewTrack';
import { handleClearSolos } from '../handlers/track/clearSolos';
import { handleCreateFolder } from '../handlers/track/createFolder';
import { handleDisableTrack } from '../handlers/track/disableTrack';
import { handleDuplicateTrack } from '../handlers/track/duplicateTrack';
import { handleFlattenTrack } from '../handlers/track/flattenTrack';
import { handleFoldTrack } from '../handlers/track/foldTrack';
import { handleFreezeTrack } from '../handlers/track/freezeTrack';
import { handleGroupTracks } from '../handlers/track/groupTracks';
import { handleAddTrack } from '../handlers/track/handleAddTrack';
import { handleConsolidateAllTracks } from '../handlers/track/handleConsolidateAllTracks';
import { handleCreateBus } from '../handlers/track/handleCreateBus';
import { handleRemoveAllTracks } from '../handlers/track/handleRemoveAllTracks';
import { handleRemoveTrack } from '../handlers/track/handleRemoveTrack';
import { handleSetTrackColor } from '../handlers/track/handleSetTrackColor';
import { handleSetTrackGain } from '../handlers/track/handleSetTrackGain';
import { handleSetTrackInput } from '../handlers/track/handleSetTrackInput';
import { handleSetTrackPan } from '../handlers/track/handleSetTrackPan';
import { handleHideTrack } from '../handlers/track/hideTrack';
import { handleMuteTrack } from '../handlers/track/muteTrack';
import { handleRenameTrack } from '../handlers/track/renameTrack';
import { handleReorderTrack } from '../handlers/track/reorderTrack';
import { handleSelectTrack } from '../handlers/track/selectTrack';
import { handleSetAutomationMode } from '../handlers/track/setAutomationMode';
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
import { handleSwitchTrackAlternative } from '../handlers/trackAlternative/handleSwitchTrackAlternative';
import { handleAssignToVca } from '../handlers/vca/handleAssignToVca';
import { handleCreateVcaGroup } from '../handlers/vca/handleCreateVcaGroup';
import { handleRemoveFromVca } from '../handlers/vca/handleRemoveFromVca';
import { handleSetVcaGain } from '../handlers/vca/handleSetVcaGain';

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
        setClipStretchMode: handleSetClipStretchMode,
        setClipStretchRatio: handleSetClipStretchRatio,
        fitClipToBeats: handleFitClipToBeats,
        loadPreset: handleLoadPreset,
        savePreset: handleSavePreset,
        restoreTrack: handleRestoreTrack,
        restoreClip: handleRestoreClip,
        addDevice: handleAddDevice,
        bypassDevice: handleBypassDevice,
        removeDevice: handleRemoveDevice,
        setDeviceParameter: handleSetDeviceParameter,
        setSend: handleSetSend,
        addSend: handleAddSend,
        removeSend: handleRemoveSend,
        enableMpe: handleEnableMpe,
        disableMpe: handleDisableMpe,
        getLatencyReport: handleGetLatencyReport,
        addSidechainRoute: handleAddSidechainRoute,
        removeSidechainRoute: handleRemoveSidechainRoute,
        generateFill: handleGenerateFill,
        generateAllTransitions: handleGenerateAllTransitions,
        compareToReference: handleCompareToReference,
        toggleControlRoomMono: handleToggleControlRoomMono,
        toggleControlRoomDim: handleToggleControlRoomDim,
        switchMonitor: handleSwitchMonitor,
        getMentorTips: handleGetMentorTips,
        searchSamples: handleSearchSamples,
        createCompGroup: handleCreateCompGroup,
        togglePunchRecording: handleTogglePunchRecording,
        toggleLoopRecord: handleToggleLoopRecord,
        triggerScene: handleTriggerScene,
        nextSetlistItem: handleNextSetlistItem,
        previousSetlistItem: handlePreviousSetlistItem,
        createAdjustmentLayer: handleCreateAdjustmentLayer,
        removeAdjustmentLayer: handleRemoveAdjustmentLayer,
        toggleAdjustmentLayer: handleToggleAdjustmentLayer,
        setLayerParameter: handleSetLayerParameter,
        setLayerMix: handleSetLayerMix,
        addAdjustmentRegion: handleAddAdjustmentRegion,
        removeAdjustmentRegion: handleRemoveAdjustmentRegion,
        moveAdjustmentRegion: handleMoveAdjustmentRegion,
        setLayerFades: handleSetLayerFades,
        setLayerAffectedTracks: handleSetLayerAffectedTracks,
        setLayerInsertionIndex: handleSetLayerInsertionIndex,
        ...clipHandlers,
    };
}
