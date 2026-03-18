/**
 * Action → human-readable label map, used by both PromptBar and
 * AiActionHistoryPanel to display previews and history entries.
 */

import { type AppAction } from '#/modules/Command/models/AppAction';

export const ACTION_LABELS: Record<string, string> = {
    addTrack: 'Add track',
    removeTrack: 'Remove track',
    renameTrack: 'Rename track',
    selectTrack: 'Select track',
    muteTrack: 'Mute/unmute',
    soloTrack: 'Solo/unsolo',
    armTrack: 'Arm/disarm',
    reorderTrack: 'Reorder track',
    setTempo: 'Set tempo',
    togglePlayback: 'Play/pause',
    stopPlayback: 'Stop',
    toggleRecording: 'Record',
    setLoopRegion: 'Set loop',
    addClip: 'Add clip',
    addDevice: 'Add device',
    setDeviceParameter: 'Set parameter',
    setTrackGain: 'Set gain',
    setTrackPan: 'Set pan',
    setTrackColor: 'Set color',
    setWorkspaceMode: 'Switch view',
    toggleSidebar: 'Toggle sidebar',
    toggleInspector: 'Toggle inspector',
    setEditingTool: 'Set tool',
    duplicateClip: 'Duplicate clip',
    removeClip: 'Remove clip',
    trimClipStart: 'Trim start',
    trimClipEnd: 'Trim end',
    quantizeNotes: 'Quantize',
    transposeNotes: 'Transpose',
    humanizeNotes: 'Humanize',
    invertNotes: 'Invert notes',
    retrogradeNotes: 'Retrograde',
    createBus: 'Create bus',
    createFolder: 'Create folder',
    addSection: 'Add section',
    renameSection: 'Rename section',
    addAutomationLane: 'Add automation',
    addAutomationPoint: 'Set automation',
};

/**
 * Produce a human-readable summary for a single action.
 */
export const describeAction = (action: AppAction): string => {
    const base = ACTION_LABELS[action.type] ?? action.type;
    const p = action.payload as Record<string, unknown> | undefined;
    if (!p) {
        return base;
    }
    if ('name' in p && typeof p.name === 'string') {
        return `${base}: ${p.name}`;
    }
    if ('bpm' in p) {
        return `${base}: ${p.bpm} BPM`;
    }
    if ('kind' in p) {
        return `${base} (${p.kind})`;
    }
    if ('deviceType' in p) {
        return `${base}: ${p.deviceType}`;
    }
    if ('paramId' in p && 'value' in p) {
        return `${base}: ${p.paramId} = ${p.value}`;
    }
    if ('semitones' in p) {
        return `${base}: ${(p.semitones as number) > 0 ? '+' : ''}${p.semitones}st`;
    }
    if ('gain' in p) {
        return `${base}: ${Math.round((p.gain as number) * 100)}%`;
    }
    if ('tool' in p) {
        return `${base}: ${p.tool}`;
    }
    return base;
};
