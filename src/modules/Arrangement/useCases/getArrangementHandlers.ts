import { type ActionHandler } from '#/modules/Command';
import { handleAddTrack } from '../handlers/track/handleAddTrack';
import { handleArmTrack } from '../handlers/track/handleArmTrack';
import { handleBounceInPlace } from '../handlers/track/handleBounceInPlace';
import { handleBounceToNewTrack } from '../handlers/track/handleBounceToNewTrack';
import { handleClearSolos } from '../handlers/track/handleClearSolos';
import { handleConsolidateAllTracks } from '../handlers/track/handleConsolidateAllTracks';
import { handleCreateBus } from '../handlers/track/handleCreateBus';
import { handleCreateFolder } from '../handlers/track/handleCreateFolder';
import { handleDisableTrack } from '../handlers/track/handleDisableTrack';
import { handleDuplicateTrack } from '../handlers/track/handleDuplicateTrack';
import { handleFoldTrack } from '../handlers/track/handleFoldTrack';
import { handleFreezeTrack } from '../handlers/track/handleFreezeTrack';
import { handleGroupTracks } from '../handlers/track/handleGroupTracks';
import { handleHideTrack } from '../handlers/track/handleHideTrack';
import { handleMuteTrack } from '../handlers/track/handleMuteTrack';
import { handleRemoveAllTracks } from '../handlers/track/handleRemoveAllTracks';
import { handleRemoveTrack } from '../handlers/track/handleRemoveTrack';
import { handleRenameTrack } from '../handlers/track/handleRenameTrack';
import { handleReorderTrack } from '../handlers/track/handleReorderTrack';
import { handleSelectTrack } from '../handlers/track/handleSelectTrack';
import { handleSetAutomationMode } from '../handlers/track/handleSetAutomationMode';
import { handleSetTrackColor } from '../handlers/track/handleSetTrackColor';
import { handleSetTrackGain } from '../handlers/track/handleSetTrackGain';
import { handleSetTrackHeight } from '../handlers/track/handleSetTrackHeight';
import { handleSetTrackInput } from '../handlers/track/handleSetTrackInput';
import { handleSetTrackNotes } from '../handlers/track/handleSetTrackNotes';
import { handleSetTrackOutput } from '../handlers/track/handleSetTrackOutput';
import { handleSetTrackPan } from '../handlers/track/handleSetTrackPan';
import { handleSoloTrack } from '../handlers/track/handleSoloTrack';
import { handleToggleSoloSafe } from '../handlers/track/handleToggleSoloSafe';
import { handleUngroupTracks } from '../handlers/track/handleUngroupTracks';
import { handleUnfreezeTrack } from '../handlers/track/handleUnfreezeTrack';
import { handleZoomTracksVertical } from '../handlers/track/handleZoomTracksVertical';
import { batchFeatureHandlers } from './batchFeatureHandlers';
import { clipHandlers } from './clipHandlers';
import { deviceHandlers } from './deviceHandlers';
import { newFeatureHandlers } from './newFeatureHandlers';
import { presetHandlers } from './presetHandlers';
import { restoreHandlers } from './restoreHandlers';
import { stretchHandlers } from './stretchHandlers';

/**
 * Sole cross-module entry for Arrangement command-handler maps.
 * Does **not** call `createHandler` / `createHandlers` — those run in handler modules (`export const handleX = createHandler(...)`).
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
        ...clipHandlers,
        ...restoreHandlers,
        ...deviceHandlers,
        ...presetHandlers,
        ...stretchHandlers,
        ...newFeatureHandlers,
        ...batchFeatureHandlers,
    };
}
