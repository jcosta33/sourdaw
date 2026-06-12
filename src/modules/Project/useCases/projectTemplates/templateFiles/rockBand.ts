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
    setMasterChain,
} from '../templateHelpers/builder';

export async function createRockBandTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Rock Band',
        bpm: 120,
        timeSig: [4, 4],
        keyRoot: 4,
        scaleName: 'minor',
        loopEnd: totalBeats,
    });

    const drumBus = createBus({
        name: 'Drum Bus',
        devices: [
            {
                type: 'builtin-compressor',
                name: 'NY Comp',
                params: {
                    'comp-threshold': -28,
                    'comp-ratio': 8,
                    'comp-attack': 2,
                    'comp-release': 80,
                    'comp-knee': 0,
                    'comp-makeup': 6,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Drum Bus EQ',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 90,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1.5,
                    'eq-mid-freq': 450,
                    'eq-mid-q': 1.2,
                    'eq-high-gain': 2,
                    'eq-high-freq': 9000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const guitarBus = createBus({
        name: 'Guitar Bus',
        devices: [
            {
                type: 'builtin-convolution-reverb',
                name: 'Room IR',
                params: {
                    'conv-ir': 2,
                    'conv-mix': 0.35,
                    'conv-predelay': 12,
                    'conv-lowcut': 120,
                    'conv-highcut': 9000,
                },
            },
        ],
    });
    const reverbPlate = createBus({
        name: 'Reverb Plate',
        devices: [{ type: 'faust-zita-rev1-reverb', name: 'Plate', params: { dry_wet: 1 } }],
    });
    const reverbHall = createBus({
        name: 'Reverb Hall',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Hall',
                params: { 'rev-size': 0.85, 'rev-decay': 3.5, 'rev-damping': 0.3, 'rev-mix': 1 },
            },
        ],
    });
    const tapeDelay = createBus({
        name: 'Tape Delay',
        devices: [
            { type: 'faust-tape-delay', name: 'Tape Delay', params: { delay: 0.375, feedback: 0.4, dry_wet: 1 } },
        ],
    });

    const drumFolder = createFolder({ name: 'Drums' });
    const rockKick = createAudioTrack({
        name: 'Kick',
        parentId: drumFolder.id,
        devices: [
            {
                type: 'builtin-eq',
                name: 'Kick EQ',
                params: {
                    'eq-low-gain': 3,
                    'eq-low-freq': 70,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -3,
                    'eq-mid-freq': 400,
                    'eq-mid-q': 1.2,
                    'eq-high-gain': 2,
                    'eq-high-freq': 4500,
                    'eq-high-q': 0.8,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Kick Comp',
                params: {
                    'comp-threshold': -14,
                    'comp-ratio': 4,
                    'comp-attack': 10,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 3,
                },
            },
        ],
    });
    const rockSnare = createAudioTrack({
        name: 'Snare',
        parentId: drumFolder.id,
        devices: [
            {
                type: 'builtin-eq',
                name: 'Snare EQ',
                params: {
                    'eq-low-gain': 1,
                    'eq-low-freq': 180,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1,
                    'eq-mid-freq': 600,
                    'eq-mid-q': 1,
                    'eq-high-gain': 3,
                    'eq-high-freq': 7000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Snare Comp',
                params: {
                    'comp-threshold': -16,
                    'comp-ratio': 4,
                    'comp-attack': 5,
                    'comp-release': 100,
                    'comp-knee': 4,
                    'comp-makeup': 3,
                },
            },
        ],
    });
    const rockHat = createAudioTrack({ name: 'Hat', parentId: drumFolder.id });
    const ohL = createAudioTrack({ name: 'OH L', parentId: drumFolder.id, pan: -0.7 });
    const ohR = createAudioTrack({ name: 'OH R', parentId: drumFolder.id, pan: 0.7 });
    const rockTom = createAudioTrack({ name: 'Tom', parentId: drumFolder.id });
    for (const drum of [rockKick, rockSnare, rockHat, ohL, ohR, rockTom]) {
        addSend({ from: drum, to: drumBus, level: 0.9 });
    }
    addSend({ from: rockSnare, to: reverbPlate, level: 0.35 });
    addSend({ from: rockSnare, to: reverbHall, level: 0.2 });
    addSend({ from: rockTom, to: reverbHall, level: 0.3 });

    const rockBass = createInstrumentTrack({
        name: 'Bass',
        deviceType: 'builtin-synth',
        deviceName: 'Rock Bass',
        deviceParams: { waveform: 2, attack: 0.005, release: 0.2, filterCutoff: 2800, subOscLevel: 0.4, gain: 0.5 },
        extraDevices: [
            {
                type: 'builtin-eq',
                name: 'Bass EQ',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 90,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': 1,
                    'eq-mid-freq': 800,
                    'eq-mid-q': 1.1,
                    'eq-high-gain': 0,
                    'eq-high-freq': 5000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Bass Comp',
                params: {
                    'comp-threshold': -14,
                    'comp-ratio': 4,
                    'comp-attack': 8,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 2,
                },
            },
        ],
    });

    const guitarFolder = createFolder({ name: 'Guitars' });
    const rhythmL = createAudioTrack({
        name: 'Rhythm Gtr L',
        parentId: guitarFolder.id,
        pan: -0.8,
        devices: [{ type: 'grinder', name: 'Amp L', params: {} }],
    });
    const rhythmR = createAudioTrack({
        name: 'Rhythm Gtr R',
        parentId: guitarFolder.id,
        pan: 0.8,
        devices: [{ type: 'grinder', name: 'Amp R', params: {} }],
    });
    const leadGtr = createAudioTrack({
        name: 'Lead Gtr',
        parentId: guitarFolder.id,
        devices: [
            { type: 'grinder', name: 'Amp Lead', params: {} },
            {
                type: 'builtin-delay',
                name: 'Lead Delay',
                params: { 'delay-time': 375, 'delay-feedback': 0.35, 'delay-mix': 0.22 },
            },
        ],
    });
    for (const guitar of [rhythmL, rhythmR, leadGtr]) {
        addSend({ from: guitar, to: guitarBus, level: 0.45 });
    }
    addSend({ from: leadGtr, to: reverbPlate, level: 0.3 });
    addSend({ from: leadGtr, to: tapeDelay, level: 0.3 });

    const vocalFolder = createFolder({ name: 'Vocals' });
    const leadVocal = createAudioTrack({
        name: 'Lead Vocal',
        parentId: vocalFolder.id,
        devices: [
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-compressor',
                name: 'Vox Comp',
                params: {
                    'comp-threshold': -16,
                    'comp-ratio': 3,
                    'comp-attack': 5,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 2,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Vox EQ',
                params: {
                    'eq-low-gain': -2,
                    'eq-low-freq': 100,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1.5,
                    'eq-mid-freq': 3000,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const backupL = createAudioTrack({ name: 'Backup L', parentId: vocalFolder.id, pan: -0.5 });
    const backupR = createAudioTrack({ name: 'Backup R', parentId: vocalFolder.id, pan: 0.5 });
    addSend({ from: leadVocal, to: reverbPlate, level: 0.3 });
    addSend({ from: leadVocal, to: tapeDelay, level: 0.25 });
    addSend({ from: backupL, to: reverbHall, level: 0.4 });
    addSend({ from: backupR, to: reverbHall, level: 0.4 });

    addDeviceChain(rockKick, [
        {
            type: 'builtin-compressor',
            name: 'Kick Punch',
            params: {
                'comp-threshold': -12,
                'comp-ratio': 4,
                'comp-attack': 15,
                'comp-release': 120,
                'comp-knee': 4,
                'comp-makeup': 2,
            },
        },
    ]);

    const drumsVca = createVca({ name: 'Drums VCA', members: [rockKick, rockSnare, rockHat, ohL, ohR, rockTom] });
    const bassVca = createVca({ name: 'Bass VCA', members: [rockBass] });
    const guitarsVca = createVca({ name: 'Guitars VCA', members: [rhythmL, rhythmR, leadGtr] });
    const vocalsVca = createVca({ name: 'Vocals VCA', members: [leadVocal, backupL, backupR] });

    setChordProgression({
        chords: [
            { root: 4, quality: 'minor', duration: 16 },
            { root: 0, quality: 'major', duration: 16 },
            { root: 7, quality: 'major', duration: 16 },
            { root: 2, quality: 'major', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 8, endBeat: 24, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 24, endBeat: 40, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 40, endBeat: 48, name: 'Solo', color: 'oklch(0.40 0.08 70)' },
        { startBeat: 48, endBeat: 56, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 56, endBeat: totalBeats, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 8, name: 'Verse' },
        { beat: 24, name: 'Chorus' },
        { beat: 40, name: 'Solo' },
        { beat: 48, name: 'Chorus' },
        { beat: 56, name: 'Outro' },
    ]);

    setMasterChain(masterTrack, 'rock');

    const tracks = [
        masterTrack,
        drumBus,
        guitarBus,
        reverbPlate,
        reverbHall,
        tapeDelay,
        drumFolder,
        rockKick,
        rockSnare,
        rockHat,
        ohL,
        ohR,
        rockTom,
        rockBass,
        guitarFolder,
        rhythmL,
        rhythmR,
        leadGtr,
        vocalFolder,
        leadVocal,
        backupL,
        backupR,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: leadVocal.id,
        vcaGroups: [drumsVca, bassVca, guitarsVca, vocalsVca],
    });
}
