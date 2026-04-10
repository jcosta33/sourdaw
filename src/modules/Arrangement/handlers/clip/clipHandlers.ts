import { handleAddClip } from './handleAddClip';
import { handleArpeggiate } from './handleArpeggiate';
import { handleAudioToMidi } from './handleAudioToMidi';
import { handleBounceSelection } from './handleBounceSelection';
import { handleConsolidateSelection } from './handleConsolidateSelection';
import { handleCopyClip } from './handleCopyClip';
import { handleCrossfadeClips } from './handleCrossfadeClips';
import { handleCutClip } from './handleCutClip';
import { handleDeleteTime } from './handleDeleteTime';
import { handleDetectKey } from './handleDetectKey';
import { handleDetectTempo } from './handleDetectTempo';
import { handleDuplicateClip } from './handleDuplicateClip';
import { handleDuplicateClipToNextBar } from './handleDuplicateClipToNextBar';
import { handleDuplicateTimeRange } from './handleDuplicateTimeRange';
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
    duplicateClip: handleDuplicateClip,
    duplicateClipToNextBar: handleDuplicateClipToNextBar,
    removeClip: handleRemoveClip,
    renameClip: handleRenameClip,
    splitClip: handleSplitClip,
    trimClipStart: handleTrimClipStart,
    trimClipEnd: handleTrimClipEnd,
    setClipFade: handleSetClipFade,
    copyClip: handleCopyClip,
    cutClip: handleCutClip,
    pasteClip: handlePasteClip,
    normalizeClip: handleNormalizeClip,
    reverseClip: handleReverseClip,
    glueClips: handleGlueClips,
    nudgeClip: handleNudgeClip,
    crossfadeClips: handleCrossfadeClips,
    setClipGain: handleSetClipGain,
    setClipColor: handleSetClipColor,
    lockClip: handleLockClip,
    setClipLoop: handleSetClipLoop,
    setClipLoopLength: handleSetClipLoopLength,
    consolidateSelection: handleConsolidateSelection,
    bounceSelection: handleBounceSelection,
    muteClip: handleMuteClip,
    audioToMidi: handleAudioToMidi,
    deleteTime: handleDeleteTime,
    insertTime: handleInsertTime,
    duplicateTimeRange: handleDuplicateTimeRange,
    stripSilence: handleStripSilence,
    detectTempo: handleDetectTempo,
    detectKey: handleDetectKey,
    arpeggiate: handleArpeggiate,
};
