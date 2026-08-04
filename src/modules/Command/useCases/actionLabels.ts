/**
 * Action → human-readable label map, used by both PromptBar and
 * AiActionHistoryPanel to display previews and history entries.
 */

import { type AppAction } from '#/utils/handlerContract';

export const ACTION_LABELS: Record<string, string> = {
    addTrack: 'Add track',
    removeTrack: 'Remove track',
    renameTrack: 'Rename track',
    selectTrack: 'Select track',
    muteTrack: 'Mute/unmute',
    soloTrack: 'Solo/unsolo',
    setSoloSafe: 'Set solo safe',
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
    openPreferencesDialog: 'Open preferences',
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
    undo: 'Undo',
    redo: 'Redo',
};

// Domain acronyms that must survive camelCase→words humanization with their
// canonical casing instead of being lower-cased ("midi" → "MIDI"). Keyed by
// the lower-cased token the splitter produces.
const ACRONYMS: Record<string, string> = {
    midi: 'MIDI',
    mpe: 'MPE',
    vca: 'VCA',
    cv: 'CV',
    rave: 'RAVE',
    crdt: 'CRDT',
    daw: 'DAW',
    cc: 'CC',
    ai: 'AI',
    bpm: 'BPM',
};

/**
 * Humanize a camelCase action type into a sentence-case label. This is the
 * total fallback used for any action type not in `ACTION_LABELS`, so that the
 * UI never displays a raw enum string (e.g. `setMasterGain` → "Set master
 * gain", `freezeTrack` → "Freeze track", `audioToMidi` → "Audio to MIDI").
 */
function humanizeActionType(type: string): string {
    // Split camelCase / PascalCase into tokens; also split letter↔digit runs
    // (e.g. `duplicateClipToNextBar`, `setRaveBlend`).
    const tokens = type
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replaceAll(/([A-Za-z])([0-9])/g, '$1 $2')
        .replaceAll(/([0-9])([A-Za-z])/g, '$1 $2')
        .split(/\s+/)
        .filter((token) => token.length > 0);
    if (tokens.length === 0) {
        return type;
    }
    const words = tokens.map((token, index) => {
        const lower = token.toLowerCase();
        const acronym = ACRONYMS[lower];
        if (acronym) {
            return acronym;
        }
        if (index === 0) {
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }
        return lower;
    });
    return words.join(' ');
}

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
