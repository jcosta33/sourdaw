import { handleAddClip } from './handleAddClip';
import { handleArpeggiate } from './handleArpeggiate';
import { handleBounceSelection } from './handleBounceSelection';
import { handleConsolidateSelection } from './handleConsolidateSelection';
import { handleCopyClip } from './handleCopyClip';
import { handleCrossfadeClips } from './handleCrossfadeClips';
import { handleCutClip } from './handleCutClip';
import { handleDeleteTime } from './handleDeleteTime';
import { handleDiscardDuplicatedClip } from './handleDiscardDuplicatedClip';
import { handleDuplicateClip } from './handleDuplicateClip';
import { handleDuplicateClipToNextBar } from './handleDuplicateClipToNextBar';
import { handleDuplicateTimeRange } from './handleDuplicateTimeRange';
import { handleExportMidi } from './handleExportMidi';
import { handleGlueClips } from './handleGlueClips';
import { handleInsertTime } from './handleInsertTime';
import { handleLockClip } from './handleLockClip';
import { handleMoveClip } from './handleMoveClip';
import { handleMuteClip } from './handleMuteClip';
import { handleNormalizeClip } from './handleNormalizeClip';
import { handleNudgeClip } from './handleNudgeClip';
import { handlePasteClip } from './handlePasteClip';
import { handleRemoveClip } from './handleRemoveClip';
import { handleRenameClip } from './handleRenameClip';
import { handleRestoreClipGlueState } from './handleRestoreClipGlueState';
import { handleRestoreClipLoop } from './handleRestoreClipLoop';
import { handleRestoreClipLoopLength } from './handleRestoreClipLoopLength';
import { handleRestoreClipPlacement } from './handleRestoreClipPlacement';
import { handleRestoreClipSplitState } from './handleRestoreClipSplitState';
import { handleRestoreCrossfadeClips } from './handleRestoreCrossfadeClips';
import { handleRestoreStripSilenceState } from './handleRestoreStripSilenceState';
import { handleReverseClip } from './handleReverseClip';
import { handleSetClipColor } from './handleSetClipColor';
import { handleSetClipFade } from './handleSetClipFade';
import { handleSetClipGain } from './handleSetClipGain';
import { handleSetClipLoop } from './handleSetClipLoop';
import { handleSetClipLoopLength } from './handleSetClipLoopLength';
import { handleSplitClip } from './handleSplitClip';
import { handleStripSilence } from './handleStripSilence';
import { handleTrimClipEnd } from './handleTrimClipEnd';
import { handleTrimClipStart } from './handleTrimClipStart';

export const clipHandlers = {
    addClip: handleAddClip,
    moveClip: handleMoveClip,
    restoreClipPlacement: handleRestoreClipPlacement,
    discardDuplicatedClip: handleDiscardDuplicatedClip,
    duplicateClip: handleDuplicateClip,
    duplicateClipToNextBar: handleDuplicateClipToNextBar,
    removeClip: handleRemoveClip,
    renameClip: handleRenameClip,
    splitClip: handleSplitClip,
    restoreClipSplitState: handleRestoreClipSplitState,
    trimClipStart: handleTrimClipStart,
    trimClipEnd: handleTrimClipEnd,
    setClipFade: handleSetClipFade,
    copyClip: handleCopyClip,
    cutClip: handleCutClip,
    pasteClip: handlePasteClip,
    normalizeClip: handleNormalizeClip,
    reverseClip: handleReverseClip,
    glueClips: handleGlueClips,
    restoreClipGlueState: handleRestoreClipGlueState,
    nudgeClip: handleNudgeClip,
    crossfadeClips: handleCrossfadeClips,
    restoreCrossfadeClips: handleRestoreCrossfadeClips,
    setClipGain: handleSetClipGain,
    setClipColor: handleSetClipColor,
    lockClip: handleLockClip,
    setClipLoop: handleSetClipLoop,
    restoreClipLoop: handleRestoreClipLoop,
    setClipLoopLength: handleSetClipLoopLength,
    restoreClipLoopLength: handleRestoreClipLoopLength,
    consolidateSelection: handleConsolidateSelection,
    bounceSelection: handleBounceSelection,
    muteClip: handleMuteClip,
    deleteTime: handleDeleteTime,
    insertTime: handleInsertTime,
    duplicateTimeRange: handleDuplicateTimeRange,
    exportMidi: handleExportMidi,
    stripSilence: handleStripSilence,
    restoreStripSilenceState: handleRestoreStripSilenceState,
    arpeggiate: handleArpeggiate,
};
