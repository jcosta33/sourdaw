/**
 * Action → human-readable label map, used by both PromptBar and
 * AiActionHistoryPanel to display previews and history entries.
 */

import { type AppAction } from './commandQueries';

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
export function describeAction(action: AppAction): string {
    const base = ACTION_LABELS[action.type] ?? action.type;
    const param = action.payload as Record<string, unknown> | undefined;
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
        return `${base}: ${(param.semitones as number) > 0 ? '+' : ''}${param.semitones}st`;
    }
    if ('gain' in param) {
        return `${base}: ${Math.round((param.gain as number) * 100)}%`;
    }
    if ('tool' in param) {
        return `${base}: ${param.tool}`;
    }
    return base;
}
