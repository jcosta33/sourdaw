/**
 * Preset Action Registry
 *
 * A comprehensive, searchable list of every instant command the PromptBar can
 * execute without needing AI inference. Each preset has keywords for fuzzy
 * matching and a `buildAction` function that produces the AppAction(s).
 *
 * Complex / compound / parameterised commands that cannot be expressed as a
 * single preset still defer to the LLM path.
 */

import { type AppAction } from '#/modules/Command/models/AppAction';

// ── Context passed to every preset builder ──────────────────────────────

export type PresetContext = {
    selectedTrackId: string | undefined;
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

// ── Preset definition ───────────────────────────────────────────────────

export type PresetAction = {
    id: string;
    label: string;
    /** Search terms & common aliases — fuzzy matched against user input */
    keywords: string[];
    category: PresetCategory;
    /** What must be selected for this preset to be available */
    requiresSelection?: 'track' | 'clip' | 'clipMidi' | 'clipAudio';
    /** Whether this action is destructive (requires confirmation) */
    isDestructive?: boolean;
    /** Build the AppAction(s). Return `null` to indicate the preset is not applicable. */
    buildAction: (ctx: PresetContext) => AppAction | AppAction[] | null;
};

export type PresetCategory =
    | 'Transport'
    | 'Track'
    | 'Clip'
    | 'MIDI'
    | 'Device'
    | 'Workspace'
    | 'Mix'
    | 'Generate'
    | 'File'
    | 'Automation'
    | 'Collaboration';

// ── Helpers ─────────────────────────────────────────────────────────────

const trackAction = (
    type: AppAction['type'],
    payloadFn: (trackId: string) => Record<string, unknown>
): PresetAction['buildAction'] => {
    return (ctx) => {
        if (!ctx.selectedTrackId) {
            return null;
        }
        return { type, payload: payloadFn(ctx.selectedTrackId) } as AppAction;
    };
};

const clipAction = (
    type: AppAction['type'],
    payloadFn: (clipId: string) => Record<string, unknown>
): PresetAction['buildAction'] => {
    return (ctx) => {
        if (!ctx.selectedClipId) {
            return null;
        }
        return { type, payload: payloadFn(ctx.selectedClipId) } as AppAction;
    };
};

// ── The Registry ────────────────────────────────────────────────────────

export const PRESET_ACTIONS: readonly PresetAction[] = [
    // ─── Transport ──────────────────────────────────────────────────────
    {
        id: 'play',
        label: 'Play / Pause',
        keywords: ['play', 'start', 'playback', 'resume', 'pause'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePlayback' }),
    },
    {
        id: 'stop',
        label: 'Stop',
        keywords: ['stop', 'halt'],
        category: 'Transport',
        buildAction: () => ({ type: 'stopPlayback' }),
    },
    {
        id: 'record',
        label: 'Record',
        keywords: ['record', 'recording', 'arm recording'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleRecording' }),
    },
    {
        id: 'loop',
        label: 'Toggle Loop',
        keywords: ['loop', 'cycle', 'toggle loop'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleLoop' }),
    },
    {
        id: 'metronome',
        label: 'Toggle Metronome',
        keywords: ['metronome', 'click', 'click track', 'toggle metronome'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleMetronome' }),
    },
    {
        id: 'punch',
        label: 'Toggle Punch In/Out',
        keywords: ['punch', 'punch in', 'punch out', 'toggle punch'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePunch' }),
    },
    {
        id: 'count-in',
        label: 'Toggle Count-In',
        keywords: ['count in', 'count-in', 'precount', 'toggle count'],
        category: 'Transport',
        buildAction: () => ({ type: 'toggleCountIn' }),
    },
    {
        id: 'pre-roll',
        label: 'Toggle Pre-Roll',
        keywords: ['pre roll', 'pre-roll', 'preroll'],
        category: 'Transport',
        buildAction: () => ({ type: 'togglePreRoll' }),
    },

    // ─── Track — creation ───────────────────────────────────────────────
    {
        id: 'add-audio-track',
        label: 'Add Audio Track',
        keywords: ['add audio', 'new audio', 'create audio', 'audio track'],
        category: 'Track',
        buildAction: () => ({
            type: 'addTrack',
            payload: { name: `Audio ${String(Date.now() % 1000)}`, kind: 'audio' },
        }),
    },
    {
        id: 'add-midi-track',
        label: 'Add MIDI Track',
        keywords: ['add midi', 'new midi', 'create midi', 'midi track', 'instrument track'],
        category: 'Track',
        buildAction: () => ({ type: 'addTrack', payload: { name: `MIDI ${String(Date.now() % 1000)}`, kind: 'midi' } }),
    },
    {
        id: 'add-bus-track',
        label: 'Add Bus Track',
        keywords: ['add bus', 'new bus', 'create bus', 'bus track', 'aux', 'return'],
        category: 'Track',
        buildAction: () => ({ type: 'addTrack', payload: { name: `Bus ${String(Date.now() % 1000)}`, kind: 'bus' } }),
    },
    {
        id: 'add-folder',
        label: 'Create Folder Track',
        keywords: ['add folder', 'new folder', 'create folder', 'group folder'],
        category: 'Track',
        buildAction: () => ({ type: 'createFolder', payload: { name: `Folder ${String(Date.now() % 1000)}` } }),
    },

    // ─── Track — manipulation ───────────────────────────────────────────
    {
        id: 'mute-track',
        label: 'Mute Track',
        keywords: ['mute', 'mute track', 'silence track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('muteTrack', (id) => ({ trackId: id, muted: true })),
    },
    {
        id: 'unmute-track',
        label: 'Unmute Track',
        keywords: ['unmute', 'unmute track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('muteTrack', (id) => ({ trackId: id, muted: false })),
    },
    {
        id: 'solo-track',
        label: 'Solo Track',
        keywords: ['solo', 'solo track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('soloTrack', (id) => ({ trackId: id, soloed: true })),
    },
    {
        id: 'unsolo-track',
        label: 'Unsolo Track',
        keywords: ['unsolo', 'unsolo track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('soloTrack', (id) => ({ trackId: id, soloed: false })),
    },
    {
        id: 'clear-solos',
        label: 'Clear All Solos',
        keywords: ['clear solos', 'unsolo all', 'reset solos'],
        category: 'Track',
        buildAction: () => ({ type: 'clearSolos' }),
    },
    {
        id: 'arm-track',
        label: 'Arm Track for Recording',
        keywords: ['arm', 'arm track', 'record enable'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('armTrack', (id) => ({ trackId: id, armed: true })),
    },
    {
        id: 'disarm-track',
        label: 'Disarm Track',
        keywords: ['disarm', 'disarm track', 'record disable'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('armTrack', (id) => ({ trackId: id, armed: false })),
    },
    {
        id: 'duplicate-track',
        label: 'Duplicate Track',
        keywords: ['duplicate track', 'copy track', 'clone track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('duplicateTrack', (id) => ({ trackId: id })),
    },
    {
        id: 'remove-track',
        label: 'Delete Track',
        keywords: ['delete track', 'remove track'],
        category: 'Track',
        requiresSelection: 'track',
        isDestructive: true,
        buildAction: trackAction('removeTrack', (id) => ({ trackId: id })),
    },
    {
        id: 'remove-all-tracks',
        label: 'Delete All Tracks',
        keywords: ['delete all tracks', 'remove all', 'clear tracks'],
        category: 'Track',
        isDestructive: true,
        buildAction: () => ({ type: 'removeAllTracks' }),
    },
    {
        id: 'freeze-track',
        label: 'Freeze Track',
        keywords: ['freeze', 'freeze track', 'render track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('freezeTrack', (id) => ({ trackId: id })),
    },
    {
        id: 'unfreeze-track',
        label: 'Unfreeze Track',
        keywords: ['unfreeze', 'unfreeze track', 'thaw'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('unfreezeTrack', (id) => ({ trackId: id })),
    },
    {
        id: 'bounce-in-place',
        label: 'Bounce Track In Place',
        keywords: ['bounce in place', 'bounce track', 'render in place', 'bip'],
        category: 'Track',
        requiresSelection: 'track',
        isDestructive: true,
        buildAction: trackAction('bounceInPlace', (id) => ({ trackId: id })),
    },
    {
        id: 'bounce-new-track',
        label: 'Bounce to New Track',
        keywords: ['bounce to new', 'bounce new track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('bounceToNewTrack', (id) => ({ trackId: id })),
    },
    {
        id: 'hide-track',
        label: 'Hide Track',
        keywords: ['hide track', 'hide'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('hideTrack', (id) => ({ trackId: id, hidden: true })),
    },
    {
        id: 'show-track',
        label: 'Show Track',
        keywords: ['show track', 'unhide track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('hideTrack', (id) => ({ trackId: id, hidden: false })),
    },
    {
        id: 'disable-track',
        label: 'Disable Track',
        keywords: ['disable track', 'deactivate track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('disableTrack', (id) => ({ trackId: id, disabled: true })),
    },
    {
        id: 'enable-track',
        label: 'Enable Track',
        keywords: ['enable track', 'activate track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('disableTrack', (id) => ({ trackId: id, disabled: false })),
    },
    {
        id: 'fold-track',
        label: 'Fold Track',
        keywords: ['fold track', 'collapse track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('foldTrack', (id) => ({ trackId: id, folded: true })),
    },
    {
        id: 'unfold-track',
        label: 'Unfold Track',
        keywords: ['unfold track', 'expand track'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('foldTrack', (id) => ({ trackId: id, folded: false })),
    },
    {
        id: 'solo-safe',
        label: 'Toggle Solo Safe',
        keywords: ['solo safe', 'solo lock'],
        category: 'Track',
        requiresSelection: 'track',
        buildAction: trackAction('toggleSoloSafe', (id) => ({ trackId: id })),
    },

    // ─── Devices (Effects / Instruments) ────────────────────────────────
    {
        id: 'add-eq',
        label: 'Add EQ',
        keywords: ['eq', 'equalizer', 'add eq', 'parametric'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'EQ' })),
    },
    {
        id: 'add-compressor',
        label: 'Add Compressor',
        keywords: ['compressor', 'comp', 'add compressor', 'dynamics'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Compressor' })),
    },
    {
        id: 'add-reverb',
        label: 'Add Reverb',
        keywords: ['reverb', 'add reverb', 'room', 'hall', 'plate'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Reverb' })),
    },
    {
        id: 'add-delay',
        label: 'Add Delay',
        keywords: ['delay', 'add delay', 'echo', 'repeat'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Delay' })),
    },
    {
        id: 'add-gain',
        label: 'Add Gain Utility',
        keywords: ['gain', 'utility', 'add gain', 'trim', 'level'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Gain' })),
    },
    {
        id: 'add-chorus',
        label: 'Add Chorus',
        keywords: ['chorus', 'add chorus', 'ensemble'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Chorus' })),
    },
    {
        id: 'add-flanger',
        label: 'Add Flanger',
        keywords: ['flanger', 'add flanger'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Flanger' })),
    },
    {
        id: 'add-phaser',
        label: 'Add Phaser',
        keywords: ['phaser', 'add phaser', 'phase'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Phaser' })),
    },
    {
        id: 'add-distortion',
        label: 'Add Distortion',
        keywords: ['distortion', 'add distortion', 'overdrive', 'drive', 'saturation'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Distortion' })),
    },
    {
        id: 'add-limiter',
        label: 'Add Limiter',
        keywords: ['limiter', 'add limiter', 'brick wall'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Limiter' })),
    },
    {
        id: 'add-gate',
        label: 'Add Gate',
        keywords: ['gate', 'noise gate', 'add gate', 'expander'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Gate' })),
    },
    {
        id: 'add-deesser',
        label: 'Add De-esser',
        keywords: ['deesser', 'de-esser', 'sibilance'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'DeEsser' })),
    },
    {
        id: 'add-autopan',
        label: 'Add Auto Pan',
        keywords: ['auto pan', 'autopan', 'panner', 'tremolo'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'AutoPan' })),
    },
    {
        id: 'add-bitcrusher',
        label: 'Add Bit Crusher',
        keywords: ['bitcrusher', 'bit crusher', 'downsample', 'lo-fi', 'lofi'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'BitCrusher' })),
    },
    {
        id: 'add-filter',
        label: 'Add Filter',
        keywords: ['filter', 'add filter', 'lowpass', 'highpass', 'bandpass'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'Filter' })),
    },

    // ─── Clip operations ────────────────────────────────────────────────
    {
        id: 'duplicate-clip',
        label: 'Duplicate Clip',
        keywords: ['duplicate clip', 'copy clip', 'clone clip'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('duplicateClip', (id) => ({ clipId: id })),
    },
    {
        id: 'dup-clip-next-bar',
        label: 'Duplicate Clip to Next Bar',
        keywords: ['duplicate to next bar', 'copy to next bar'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('duplicateClipToNextBar', (id) => ({ clipId: id })),
    },
    {
        id: 'remove-clip',
        label: 'Delete Clip',
        keywords: ['delete clip', 'remove clip'],
        category: 'Clip',
        requiresSelection: 'clip',
        isDestructive: true,
        buildAction: clipAction('removeClip', (id) => ({ clipId: id })),
    },
    {
        id: 'copy-clip',
        label: 'Copy Clip',
        keywords: ['copy clip', 'clipboard copy'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: () => ({ type: 'copyClip' }),
    },
    {
        id: 'cut-clip',
        label: 'Cut Clip',
        keywords: ['cut clip', 'clipboard cut'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: () => ({ type: 'cutClip' }),
    },
    {
        id: 'paste-clip',
        label: 'Paste Clip',
        keywords: ['paste', 'paste clip'],
        category: 'Clip',
        buildAction: () => ({ type: 'pasteClip' }),
    },
    {
        id: 'normalize-clip',
        label: 'Normalize Clip',
        keywords: ['normalize', 'normalize clip', 'loudness'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('normalizeClip', (id) => ({ clipId: id })),
    },
    {
        id: 'reverse-clip',
        label: 'Reverse Clip',
        keywords: ['reverse clip', 'backwards'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('reverseClip', (id) => ({ clipId: id })),
    },
    {
        id: 'mute-clip',
        label: 'Mute Clip',
        keywords: ['mute clip', 'silence clip'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('muteClip', (id) => ({ clipId: id, muted: true })),
    },
    {
        id: 'unmute-clip',
        label: 'Unmute Clip',
        keywords: ['unmute clip'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('muteClip', (id) => ({ clipId: id, muted: false })),
    },
    {
        id: 'lock-clip',
        label: 'Lock Clip',
        keywords: ['lock clip', 'lock'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('lockClip', (id) => ({ clipId: id, locked: true })),
    },
    {
        id: 'unlock-clip',
        label: 'Unlock Clip',
        keywords: ['unlock clip', 'unlock'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('lockClip', (id) => ({ clipId: id, locked: false })),
    },
    {
        id: 'loop-clip',
        label: 'Enable Clip Looping',
        keywords: ['loop clip', 'enable loop', 'clip loop'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('setClipLoop', (id) => ({ clipId: id, enabled: true })),
    },
    {
        id: 'unloop-clip',
        label: 'Disable Clip Looping',
        keywords: ['unloop clip', 'disable loop'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('setClipLoop', (id) => ({ clipId: id, enabled: false })),
    },
    {
        id: 'nudge-left',
        label: 'Nudge Clip Left',
        keywords: ['nudge left', 'move clip left'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('nudgeClip', (id) => ({ clipId: id, beats: -1 })),
    },
    {
        id: 'nudge-right',
        label: 'Nudge Clip Right',
        keywords: ['nudge right', 'move clip right'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('nudgeClip', (id) => ({ clipId: id, beats: 1 })),
    },
    {
        id: 'strip-silence',
        label: 'Strip Silence',
        keywords: ['strip silence', 'remove silence', 'clean clip'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('stripSilence', (id) => ({ clipId: id })),
    },
    {
        id: 'detect-tempo',
        label: 'Detect Clip Tempo',
        keywords: ['detect tempo', 'tempo detect', 'bpm detection'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('detectTempo', (id) => ({ clipId: id })),
    },
    {
        id: 'detect-key',
        label: 'Detect Clip Key',
        keywords: ['detect key', 'key detection', 'find key'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('detectKey', (id) => ({ clipId: id })),
    },

    // ─── Stretch operations ─────────────────────────────────────────────
    {
        id: 'repitch-mode',
        label: 'Enable Repitch Mode',
        keywords: ['repitch', 'pitch stretch', 'varispeed'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('setClipStretchMode', (id) => ({ clipId: id, mode: 'repitch' })),
    },
    {
        id: 'timestretch-mode',
        label: 'Enable Timestretch',
        keywords: ['timestretch', 'time stretch', 'elastic'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('setClipStretchMode', (id) => ({ clipId: id, mode: 'timestretch' })),
    },
    {
        id: 'stretch-off',
        label: 'Disable Stretching',
        keywords: ['disable stretch', 'stretch off', 'no stretch'],
        category: 'Clip',
        requiresSelection: 'clip',
        buildAction: clipAction('setClipStretchMode', (id) => ({ clipId: id, mode: 'off' })),
    },

    // ─── MIDI operations ────────────────────────────────────────────────
    {
        id: 'quantize',
        label: 'Quantize Notes',
        keywords: ['quantize', 'snap notes', 'align notes', 'grid'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('quantizeNotes', (id) => ({ clipId: id, gridSize: 0.25 })),
    },
    {
        id: 'quantize-lengths',
        label: 'Quantize Note Lengths',
        keywords: ['quantize lengths', 'quantize durations', 'snap durations'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('quantizeNoteLengths', (id) => ({ clipId: id, gridSize: 0.25 })),
    },
    {
        id: 'humanize',
        label: 'Humanize Notes',
        keywords: ['humanize', 'randomize timing', 'feel', 'swing'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('humanizeNotes', (id) => ({ clipId: id, amount: 0.3 })),
    },
    {
        id: 'transpose-up-oct',
        label: 'Transpose Up 1 Octave',
        keywords: ['transpose up octave', 'octave up', '+12'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('transposeNotes', (id) => ({ clipId: id, semitones: 12 })),
    },
    {
        id: 'transpose-dn-oct',
        label: 'Transpose Down 1 Octave',
        keywords: ['transpose down octave', 'octave down', '-12'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('transposeNotes', (id) => ({ clipId: id, semitones: -12 })),
    },
    {
        id: 'transpose-up-5th',
        label: 'Transpose Up 5th',
        keywords: ['transpose up fifth', 'up 5th', '+7'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('transposeNotes', (id) => ({ clipId: id, semitones: 7 })),
    },
    {
        id: 'transpose-dn-5th',
        label: 'Transpose Down 5th',
        keywords: ['transpose down fifth', 'down 5th', '-7'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('transposeNotes', (id) => ({ clipId: id, semitones: -7 })),
    },
    {
        id: 'invert-notes',
        label: 'Invert Notes',
        keywords: ['invert', 'invert notes', 'mirror notes'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('invertNotes', (id) => ({ clipId: id })),
    },
    {
        id: 'retrograde-notes',
        label: 'Retrograde Notes',
        keywords: ['retrograde', 'reverse notes', 'backwards notes'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('retrogradeNotes', (id) => ({ clipId: id })),
    },
    {
        id: 'arpeggiate',
        label: 'Arpeggiate Notes',
        keywords: ['arpeggiate', 'arp', 'arpeggio'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('arpeggiate', (id) => ({ clipId: id, pattern: 'up' })),
    },
    {
        id: 'compress-vel',
        label: 'Compress Velocities',
        keywords: ['compress velocity', 'compress velocities', 'velocity compress'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('scaleVelocities', (id) => ({ clipId: id, curve: 'compress' })),
    },
    {
        id: 'expand-vel',
        label: 'Expand Velocities',
        keywords: ['expand velocity', 'expand velocities', 'velocity expand'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('scaleVelocities', (id) => ({ clipId: id, curve: 'expand' })),
    },
    {
        id: 'extract-groove',
        label: 'Extract Groove Template',
        keywords: ['extract groove', 'groove template', 'capture feel'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('extractGroove', (id) => ({ clipId: id })),
    },
    {
        id: 'audio-to-midi',
        label: 'Audio to MIDI',
        keywords: ['audio to midi', 'convert audio', 'onset detection', 'rhythm detect'],
        category: 'MIDI',
        requiresSelection: 'clip',
        buildAction: (ctx) =>
            ctx.selectedClipId
                ? { type: 'audioToMidi', payload: { clipId: ctx.selectedClipId, trackId: ctx.selectedTrackId } }
                : null,
    },

    // ─── Groove presets ─────────────────────────────────────────────────
    {
        id: 'groove-swing',
        label: 'Apply Swing Groove',
        keywords: ['swing', 'swing groove', 'shuffle'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('applyGroove', (id) => ({ clipId: id, grooveId: 'swing-light' })),
    },
    {
        id: 'groove-heavy-sw',
        label: 'Apply Heavy Swing',
        keywords: ['heavy swing', 'swing heavy'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('applyGroove', (id) => ({ clipId: id, grooveId: 'swing-heavy' })),
    },
    {
        id: 'groove-mpc60',
        label: 'Apply MPC 60 Groove',
        keywords: ['mpc', 'mpc 60', 'mpc60', 'mpc feel'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('applyGroove', (id) => ({ clipId: id, grooveId: 'mpc-60' })),
    },
    {
        id: 'groove-sp1200',
        label: 'Apply SP-1200 Groove',
        keywords: ['sp1200', 'sp 1200', 'sp-1200'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('applyGroove', (id) => ({ clipId: id, grooveId: 'sp-1200' })),
    },
    {
        id: 'groove-straight',
        label: 'Apply Straight Groove',
        keywords: ['straight', 'straight groove', 'no swing'],
        category: 'MIDI',
        requiresSelection: 'clipMidi',
        buildAction: clipAction('applyGroove', (id) => ({ clipId: id, grooveId: 'straight' })),
    },

    // ─── Generate ───────────────────────────────────────────────────────
    {
        id: 'gen-drum-rock',
        label: 'Generate Rock Drums',
        keywords: ['rock drums', 'rock beat', 'rock pattern'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'rock', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-4floor',
        label: 'Generate Four-on-Floor',
        keywords: ['four on floor', 'four on the floor', 'house beat', 'disco'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'four-on-floor', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-trap',
        label: 'Generate Trap Beat',
        keywords: ['trap drums', 'trap beat', 'trap pattern', '808'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'trap', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-jazz',
        label: 'Generate Jazz Drums',
        keywords: ['jazz drums', 'jazz beat', 'jazz pattern', 'bebop'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'jazz', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-dnb',
        label: 'Generate DnB Beat',
        keywords: ['dnb', 'drum and bass', 'jungle', 'breakbeat'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'dnb', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-latin',
        label: 'Generate Latin Drums',
        keywords: ['latin drums', 'bossa', 'samba', 'clave'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'latin', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-halftime',
        label: 'Generate Half-Time Beat',
        keywords: ['half time', 'halftime', 'half-time'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'half-time', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-melody',
        label: 'Generate Melody',
        keywords: ['generate melody', 'create melody', 'random melody'],
        category: 'Generate',
        buildAction: (ctx) => ({ type: 'generateMelody', payload: { style: 'simple', trackId: ctx.selectedTrackId } }),
    },
    {
        id: 'gen-melody-arp',
        label: 'Generate Arpeggiated Melody',
        keywords: ['arpeggiated melody', 'arp melody'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateMelody',
            payload: { style: 'arpeggiated', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-melody-ambient',
        label: 'Generate Ambient Melody',
        keywords: ['ambient melody', 'pad melody', 'atmospheric'],
        category: 'Generate',
        buildAction: (ctx) => ({ type: 'generateMelody', payload: { style: 'ambient', trackId: ctx.selectedTrackId } }),
    },
    {
        id: 'gen-chords-pop',
        label: 'Generate Pop Chords',
        keywords: ['pop chords', 'chord progression', 'pop progression'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'pop', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-jazz',
        label: 'Generate Jazz Chords',
        keywords: ['jazz chords', 'jazz progression', '7th chords'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'jazz', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-edm',
        label: 'Generate EDM Chords',
        keywords: ['edm chords', 'edm progression', 'trance chords'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'edm', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-cinematic',
        label: 'Generate Cinematic Chords',
        keywords: ['cinematic chords', 'epic chords', 'film chords', 'orchestral'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'cinematic', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-blues',
        label: 'Generate Blues Chords',
        keywords: ['blues chords', 'blues progression', '12 bar blues'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'blues', trackId: ctx.selectedTrackId },
        }),
    },

    // ─── Workspace / Views ──────────────────────────────────────────────
    {
        id: 'view-arrange',
        label: 'Switch to Arrange View',
        keywords: ['arrange', 'arrange view', 'arrangement', 'timeline'],
        category: 'Workspace',
        buildAction: () => ({ type: 'setWorkspaceMode', payload: { mode: 'arrange' } }),
    },
    {
        id: 'view-clip',
        label: 'Switch to Clip View',
        keywords: ['clip view', 'clip editor', 'piano roll', 'editor'],
        category: 'Workspace',
        buildAction: () => ({ type: 'setWorkspaceMode', payload: { mode: 'clip' } }),
    },
    {
        id: 'view-mix',
        label: 'Open Mixer Panel',
        keywords: ['mix view', 'mixer', 'console', 'faders'],
        category: 'Workspace',
        buildAction: () => ({ type: 'openMixer' }),
    },
    {
        id: 'open-mixer',
        label: 'Open Mixer Panel',
        keywords: ['open mixer', 'show mixer'],
        category: 'Workspace',
        buildAction: () => ({ type: 'openMixer' }),
    },
    {
        id: 'close-mixer',
        label: 'Close Mixer Panel',
        keywords: ['close mixer', 'hide mixer'],
        category: 'Workspace',
        buildAction: () => ({ type: 'closeMixer' }),
    },
    {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        keywords: ['sidebar', 'browser', 'toggle sidebar', 'show browser', 'hide browser'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleSidebar' }),
    },
    {
        id: 'toggle-inspector',
        label: 'Toggle Inspector',
        keywords: ['inspector', 'toggle inspector', 'show inspector', 'hide inspector', 'properties'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleInspector' }),
    },
    {
        id: 'toggle-chat',
        label: 'Toggle AI Chat Panel',
        keywords: ['chat', 'ai chat', 'toggle chat', 'copilot'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleChatPanel' }),
    },
    {
        id: 'zoom-fit',
        label: 'Zoom to Fit',
        keywords: ['zoom fit', 'zoom to fit', 'fit all', 'overview'],
        category: 'Workspace',
        buildAction: () => ({ type: 'zoomToFit' }),
    },
    {
        id: 'zoom-selection',
        label: 'Zoom to Selection',
        keywords: ['zoom selection', 'zoom to selection', 'fit selection'],
        category: 'Workspace',
        buildAction: () => ({ type: 'zoomToSelection' }),
    },
    {
        id: 'preferences',
        label: 'Open Preferences',
        keywords: ['preferences', 'settings', 'options', 'config'],
        category: 'Workspace',
        buildAction: () => {
            document.dispatchEvent(new CustomEvent('webdaw:open-preferences'));
            return [];
        },
    },

    // ─── Mix operations ─────────────────────────────────────────────────
    {
        id: 'analyze-mix',
        label: 'Analyze Mix',
        keywords: ['analyze mix', 'check mix', 'mix analysis', 'loudness check'],
        category: 'Mix',
        buildAction: () => ({ type: 'analyzeMix' }),
    },
    {
        id: 'autofix-mix',
        label: 'Auto-Fix Mix',
        keywords: ['fix mix', 'auto fix', 'auto-fix mix', 'balance mix', 'auto level'],
        category: 'Mix',
        buildAction: () => ({ type: 'autoFixMix' }),
    },
    {
        id: 'consolidate-all',
        label: 'Consolidate All Tracks',
        keywords: ['consolidate all', 'bounce all', 'render all'],
        category: 'Mix',
        buildAction: () => ({ type: 'consolidateAllTracks' }),
    },

    // ─── Automation ─────────────────────────────────────────────────────
    {
        id: 'add-auto-lane',
        label: 'Add Automation Lane',
        keywords: ['automation lane', 'add automation', 'automation'],
        category: 'Automation',
        requiresSelection: 'track',
        buildAction: trackAction('addAutomationLane', (id) => ({
            trackId: id,
            parameterId: 'volume',
            parameterName: 'Volume',
        })),
    },
    {
        id: 'invert-auto',
        label: 'Invert Automation',
        keywords: ['invert automation', 'flip automation'],
        category: 'Automation',
        buildAction: () => null,
    },
    {
        id: 'thin-auto',
        label: 'Thin Automation Points',
        keywords: ['thin automation', 'reduce points', 'simplify automation'],
        category: 'Automation',
        buildAction: () => null,
    },

    // ─── File / Project ─────────────────────────────────────────────────
    {
        id: 'save',
        label: 'Save Project',
        keywords: ['save', 'save project', 'ctrl s'],
        category: 'File',
        buildAction: () => ({ type: 'saveProject' }),
    },
    {
        id: 'new-project',
        label: 'New Project',
        keywords: ['new project', 'new', 'fresh project'],
        category: 'File',
        buildAction: () => ({ type: 'newProject' }),
    },
    {
        id: 'export',
        label: 'Export / Bounce / Render',
        keywords: ['export', 'bounce', 'render', 'mixdown', 'wav', 'mp3', 'export audio'],
        category: 'File',
        buildAction: () => ({ type: 'exportProject' }),
    },
    {
        id: 'import-audio',
        label: 'Import Audio File',
        keywords: ['import audio', 'import wav', 'import mp3', 'import file', 'open audio'],
        category: 'File',
        buildAction: () => ({ type: 'importAudioFile' }),
    },
    {
        id: 'import-midi',
        label: 'Import MIDI File',
        keywords: ['import midi', 'open midi'],
        category: 'File',
        buildAction: () => ({ type: 'importMidiFile' }),
    },
    {
        id: 'scan-plugins',
        label: 'Scan Plugins',
        keywords: ['scan plugins', 'rescan plugins', 'plugin scan'],
        category: 'File',
        buildAction: () => ({ type: 'scanPlugins' }),
    },

    // ─── Collaboration ──────────────────────────────────────────────────
    {
        id: 'start-collab',
        label: 'Start Collaboration Session',
        keywords: ['collaboration', 'collab', 'start session', 'multiplayer'],
        category: 'Collaboration',
        buildAction: () => ({ type: 'createCollabSession' }),
    },
    {
        id: 'leave-collab',
        label: 'Leave Collaboration',
        keywords: ['leave session', 'stop collaboration', 'disconnect'],
        category: 'Collaboration',
        buildAction: () => ({ type: 'leaveCollabSession' }),
    },

    // ─── Undo / Redo (dispatched as DOM events) ─────────────────────────
    {
        id: 'undo',
        label: 'Undo',
        keywords: ['undo', 'ctrl z', 'cmd z'],
        category: 'File',
        buildAction: () => {
            document.dispatchEvent(new CustomEvent('webdaw:undo'));
            return [];
        },
    },
    {
        id: 'redo',
        label: 'Redo',
        keywords: ['redo', 'ctrl shift z', 'cmd shift z'],
        category: 'File',
        buildAction: () => {
            document.dispatchEvent(new CustomEvent('webdaw:redo'));
            return [];
        },
    },

    // ─── MIDI I/O ───────────────────────────────────────────────────────
    {
        id: 'enable-mpe',
        label: 'Enable MPE',
        keywords: ['mpe', 'enable mpe', 'midi polyphonic expression'],
        category: 'MIDI',
        buildAction: () => ({ type: 'enableMpe' }),
    },
    {
        id: 'disable-mpe',
        label: 'Disable MPE',
        keywords: ['disable mpe'],
        category: 'MIDI',
        buildAction: () => ({ type: 'disableMpe' }),
    },
    {
        id: 'latency-report',
        label: 'Show Latency Report',
        keywords: ['latency', 'latency report', 'audio latency'],
        category: 'Mix',
        buildAction: () => ({ type: 'getLatencyReport' }),
    },
];

// ── Category display order ──────────────────────────────────────────────

export const CATEGORY_ORDER: readonly PresetCategory[] = [
    'Transport',
    'Track',
    'Clip',
    'MIDI',
    'Device',
    'Generate',
    'Workspace',
    'Mix',
    'Automation',
    'File',
    'Collaboration',
];
