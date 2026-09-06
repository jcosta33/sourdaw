import { type PresetAction, trackAction } from './Types';

/**
 * Every entry names a plugin by its catalog **id**, never by its display label.
 *
 * `addDevice` matches on name *or* id and, on a miss, stores the string it was
 * handed as the device type — so a label the catalog does not carry under that
 * exact spelling mints a device no descriptor matches: silent in playback and
 * absent from a render. `Gate`, `DeEsser` and `AutoPan` were three such labels
 * (the catalog says `Noise Gate`, `De-esser` and `Auto-Pan`). Ids are also the
 * only unambiguous key: `De-esser`, `LUFS Meter` and `Stereo Widener` each name
 * two catalog plugins, a builtin and a Faust build.
 */
export const devicePresets: readonly PresetAction[] = [
    {
        id: 'add-eq',
        label: 'Add EQ',
        keywords: ['eq', 'equalizer', 'add eq', 'parametric'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-eq' })),
    },
    {
        id: 'add-compressor',
        label: 'Add Compressor',
        keywords: ['compressor', 'comp', 'add compressor', 'dynamics'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-compressor' })),
    },
    {
        id: 'add-reverb',
        label: 'Add Reverb',
        keywords: ['reverb', 'add reverb', 'room', 'hall', 'plate'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-reverb' })),
    },
    {
        id: 'add-delay',
        label: 'Add Delay',
        keywords: ['delay', 'add delay', 'echo', 'repeat'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-delay' })),
    },
    {
        id: 'add-gain',
        label: 'Add Gain Utility',
        keywords: ['gain', 'utility', 'add gain', 'trim', 'level'],
        commandAliases: ['add gain'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-gain' })),
    },
    {
        id: 'add-chorus',
        label: 'Add Chorus',
        keywords: ['chorus', 'add chorus', 'ensemble'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-chorus' })),
    },
    {
        id: 'add-flanger',
        label: 'Add Flanger',
        keywords: ['flanger', 'add flanger'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-flanger' })),
    },
    {
        id: 'add-phaser',
        label: 'Add Phaser',
        keywords: ['phaser', 'add phaser', 'phase'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-phaser' })),
    },
    {
        id: 'add-distortion',
        label: 'Add Distortion',
        keywords: ['distortion', 'add distortion', 'overdrive', 'drive', 'saturation'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-distortion' })),
    },
    {
        id: 'add-limiter',
        label: 'Add Limiter',
        keywords: ['limiter', 'add limiter', 'brick wall'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-limiter' })),
    },
    {
        id: 'add-gate',
        label: 'Add Gate',
        keywords: ['gate', 'noise gate', 'add gate', 'expander'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'faust-noise-gate' })),
    },
    {
        id: 'add-deesser',
        label: 'Add De-esser',
        keywords: ['deesser', 'de-esser', 'sibilance'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-deesser' })),
    },
    {
        id: 'add-autopan',
        label: 'Add Auto Pan',
        keywords: ['auto pan', 'autopan', 'panner', 'tremolo'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-autopan' })),
    },
    {
        id: 'add-bitcrusher',
        label: 'Add Bit Crusher',
        keywords: ['bitcrusher', 'bit crusher', 'downsample', 'lo-fi', 'lofi'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-bitcrusher' })),
    },
    {
        id: 'add-filter',
        label: 'Add Filter',
        keywords: ['filter', 'add filter', 'lowpass', 'highpass', 'bandpass'],
        category: 'Device',
        requiresSelection: 'track',
        buildAction: trackAction('addDevice', (id) => ({ trackId: id, deviceType: 'builtin-filter' })),
    },
];
