/**
 * Action → human-readable label map, used by both PromptBar and
 * AiActionHistoryPanel to display previews and history entries.
 */

import { type AppAction } from '#/utils/handlerContract';

import { humanizeActionType } from './humanizeActionType';

export const ACTION_LABELS: Record<string, string> = {
    addTrack: 'Add track',
    removeTrack: 'Remove track',
    renameTrack: 'Rename track',
    selectTrack: 'Select track',
    muteTrack: 'Mute/unmute',
    soloTrack: 'Solo/unsolo',
    setSoloSafe: 'Set solo safe',
    clearSolos: 'Clear solos',
    armTrack: 'Arm/disarm',
    reorderTrack: 'Reorder track',
    setTempo: 'Set tempo',
    togglePlayback: 'Play/pause',
    setPlayback: 'Set playback',
    stopPlayback: 'Stop',
    toggleRecording: 'Toggle recording',
    toggleMetronome: 'Toggle metronome',
    setLoopRegion: 'Set loop',
    toggleLoop: 'Toggle loop',
    addClip: 'Add clip',
    addDevice: 'Add device',
    setDeviceParameter: 'Set parameter',
    setTrackGain: 'Set gain',
    setTrackPan: 'Set pan',
    setTrackColor: 'Set color',
    setWorkspaceMode: 'Switch view',
    saveProject: 'Save project',
    openPreferencesDialog: 'Open preferences',
    toggleSidebar: 'Toggle sidebar',
    toggleInspector: 'Toggle inspector',
    toggleChatPanel: 'Toggle chat panel',
    setEditingTool: 'Set tool',
    zoomToFit: 'Zoom to fit',
    zoomToSelection: 'Zoom to selection',
    zoomTracksVertical: 'Zoom tracks',
    duplicateClip: 'Duplicate clip',
    cutClip: 'Cut clip',
    copyClip: 'Copy clip',
    pasteClip: 'Paste clip',
    duplicateClipToNextBar: 'Duplicate clip to next bar',
    removeClip: 'Remove clip',
    trimClipStart: 'Trim start',
    trimClipEnd: 'Trim end',
    slipClipContent: 'Slip clip content',
    drawClip: 'Draw clip',
    duplicateClipAt: 'Duplicate clip at destination',
    moveClips: 'Move clips',
    discardDrawnClip: 'Discard drawn clip',
    restoreDrawnClip: 'Restore drawn clip',
    restoreClipMoves: 'Restore clip moves',
    quantizeNotes: 'Quantize',
    removeShortMidiOverlaps: 'Remove short MIDI overlaps',
    copyMidiArticulations: 'Copy MIDI articulations',
    transposeNotes: 'Transpose',
    humanizeNotes: 'Humanize',
    invertNotes: 'Invert notes',
    retrogradeNotes: 'Retrograde',
    generateBassline: 'Generate bassline',
    generateDrumPattern: 'Generate drum pattern',
    generateMelody: 'Generate melody',
    generateChordProgression: 'Generate chord progression',
    createBus: 'Create bus',
    createFolder: 'Create folder',
    addSection: 'Add section',
    renameSection: 'Rename section',
    addAutomationLane: 'Add automation',
    addAutomationPoint: 'Set automation',
    undo: 'Undo',
    redo: 'Redo',
};

/**
 * Produce a human-readable summary for a single action.
 */
export function describeAction(action: AppAction): string {
    const base = ACTION_LABELS[action.type] ?? humanizeActionType(action.type);
    const param = action.payload;
    if (!param) {
        return base;
    }
    if ('name' in param && typeof param.name === 'string') {
        return `${base}: ${param.name}`;
    }
    if ('bpm' in param) {
        return `${base}: ${param.bpm} BPM`;
    }
    if ('kind' in param) {
        return `${base} (${param.kind})`;
    }
    if ('deviceType' in param) {
        return `${base}: ${param.deviceType}`;
    }
    if ('paramId' in param && 'value' in param) {
        return `${base}: ${param.paramId} = ${param.value}`;
    }
    if ('semitones' in param) {
        return `${base}: ${param.semitones > 0 ? '+' : ''}${param.semitones}st`;
    }
    if ('gain' in param && typeof param.gain === 'number') {
        return `${base}: ${Math.round(param.gain * 100)}%`;
    }
    if ('tool' in param) {
        return `${base}: ${param.tool}`;
    }
    return base;
}
