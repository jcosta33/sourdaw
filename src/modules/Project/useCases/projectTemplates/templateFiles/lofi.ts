import {
    addDeviceChain,
    addMarkers,
    addSections,
    addSend,
    createAudioTrack,
    createBus,
    createFolder,
    createInstrumentTrack,
    createVca,
    finalizeTemplate,
    initProject,
    setChordProgression,
    setGroove,
    setMasterChain,
} from '../templateHelpers/builder';

export async function createLofiTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Lo-fi',
        bpm: 80,
        timeSig: [4, 4],
        keyRoot: 2,
        scaleName: 'dorian',
        loopEnd: totalBeats,
    });

    setGroove({
        id: 'mpc60-65',
        name: 'MPC-60 Swing 65%',
        offsets: [0, 0.13, 0, 0.13],
        resolution: 0.25,
        intensity: 0.6,
    });

    const springReverb = createBus({
        name: 'Spring Reverb',
        devices: [{ type: 'faust-spring-reverb', name: 'Spring', params: {} }],
    });
    const tapeDelay = createBus({
        name: 'Tape Delay',
        devices: [
            { type: 'faust-tape-delay', name: 'Tape Delay', params: { delay: 0.375, feedback: 0.55, dry_wet: 1 } },
        ],
    });
    const vinylBus = createBus({
        name: 'Vinyl Bus',
        devices: [
            {
                type: 'builtin-bitcrusher',
                name: 'Crush',
                params: { 'bitcrusher-bits': 10, 'bitcrusher-rate': 0.5, 'bitcrusher-mix': 0.25 },
            },
            {
                type: 'builtin-eq',
                name: 'Hi-Cut',
                params: {
                    'eq-low-gain': 0,
                    'eq-low-freq': 100,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 1000,
                    'eq-mid-q': 1,
                    'eq-high-gain': -4,
                    'eq-high-freq': 8000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });

    const drumFolder = createFolder({ name: 'Drums' });
    const lofiKick = createInstrumentTrack({
        name: 'Lo-fi Kick',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Lo-fi Vinyl',
        deviceParams: { kit: 4, gain: 0.85 },
    });
    const lofiSnare = createInstrumentTrack({
        name: 'Snare (muffled)',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Lo-fi Vinyl',
        deviceParams: { kit: 4, gain: 0.75 },
        extraDevices: [
            {
                type: 'builtin-eq',
                name: 'Muffle',
                params: {
                    'eq-low-gain': -2,
                    'eq-low-freq': 100,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1,
                    'eq-mid-freq': 400,
                    'eq-mid-q': 1,
                    'eq-high-gain': -5,
                    'eq-high-freq': 6000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const lofiHat = createInstrumentTrack({
        name: 'Hat (tight)',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Lo-fi Vinyl',
        deviceParams: { kit: 4, gain: 0.6 },
    });
    const vinylCrackle = createAudioTrack({ name: 'Vinyl Crackle', parentId: drumFolder.id });
    for (const drum of [lofiKick, lofiSnare, lofiHat]) {
        addSend({ from: drum, to: vinylBus, level: 0.3 });
    }
    addSend({ from: vinylCrackle, to: vinylBus, level: 0.9 });

    const lofiBass = createInstrumentTrack({
        name: 'Bass',
        deviceType: 'factory-bass-sub',
        deviceName: 'Sub',
        extraDevices: [
            {
                type: 'builtin-eq',
                name: 'Bass EQ',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 500,
                    'eq-mid-q': 1,
                    'eq-high-gain': -3,
                    'eq-high-freq': 4000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });

    const melodicFolder = createFolder({ name: 'Melodic' });
    const lofiRhodes = createInstrumentTrack({
        name: 'Rhodes',
        parentId: melodicFolder.id,
        deviceType: 'factory-faust-rhodes-ambient',
        deviceName: 'Rhodes',
    });
    const samplerPluck = createInstrumentTrack({
        name: 'Sampler Pluck',
        parentId: melodicFolder.id,
        deviceType: 'factory-keys-pluck',
        deviceName: 'Pluck',
    });
    const lofiPad = createInstrumentTrack({
        name: 'Pad',
        parentId: melodicFolder.id,
        deviceType: 'factory-pad-warm',
        deviceName: 'Pad',
    });
    addSend({ from: lofiRhodes, to: springReverb, level: 0.35 });
    addSend({ from: lofiRhodes, to: tapeDelay, level: 0.3 });
    addSend({ from: lofiRhodes, to: vinylBus, level: 0.2 });
    addSend({ from: samplerPluck, to: tapeDelay, level: 0.4 });
    addSend({ from: samplerPluck, to: vinylBus, level: 0.2 });
    addSend({ from: lofiPad, to: springReverb, level: 0.45 });
    addSend({ from: lofiPad, to: vinylBus, level: 0.15 });

    const textureFolder = createFolder({ name: 'Texture' });
    const tapeHiss = createAudioTrack({ name: 'Tape Hiss', parentId: textureFolder.id });
    const wobblePad = createInstrumentTrack({
        name: 'Wobble Pad',
        parentId: textureFolder.id,
        deviceType: 'factory-pad-dark',
        deviceName: 'Wobble',
        extraDevices: [
            {
                type: 'builtin-tremolo',
                name: 'Wobble',
                params: { 'trem-rate': 0.8, 'trem-depth': 0.7, 'trem-shape': 0 },
            },
        ],
    });
    addSend({ from: wobblePad, to: springReverb, level: 0.4 });
    addSend({ from: wobblePad, to: vinylBus, level: 0.25 });

    addDeviceChain(lofiPad, [
        {
            type: 'builtin-reverb',
            name: 'Pad Verb',
            params: { 'rev-size': 0.7, 'rev-decay': 3, 'rev-damping': 0.4, 'rev-mix': 0.3 },
        },
    ]);

    const drumsVca = createVca({ name: 'Drums VCA', members: [lofiKick, lofiSnare, lofiHat, vinylCrackle] });
    const melodyVca = createVca({ name: 'Melody VCA', members: [lofiRhodes, samplerPluck, lofiPad] });

    setChordProgression({
        chords: [
            { root: 2, quality: 'min9', duration: 16 },
            { root: 7, quality: '7', duration: 16 },
            { root: 0, quality: 'maj7', duration: 16 },
            { root: 5, quality: 'maj7', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 8, endBeat: 32, name: 'Loop A', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 32, endBeat: 56, name: 'Loop B', color: 'oklch(0.40 0.08 150)' },
        { startBeat: 56, endBeat: totalBeats, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 8, name: 'Loop A' },
        { beat: 32, name: 'Loop B' },
        { beat: 56, name: 'Outro' },
    ]);

    setMasterChain(masterTrack, 'lofi');

    const tracks = [
        masterTrack,
        springReverb,
        tapeDelay,
        vinylBus,
        drumFolder,
        lofiKick,
        lofiSnare,
        lofiHat,
        vinylCrackle,
        lofiBass,
        melodicFolder,
        lofiRhodes,
        samplerPluck,
        lofiPad,
        textureFolder,
        tapeHiss,
        wobblePad,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: lofiRhodes.id,
        vcaGroups: [drumsVca, melodyVca],
    });
}
