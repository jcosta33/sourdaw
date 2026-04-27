import {
    addMarkers,
    addSections,
    addSend,
    attachSidechainCompressor,
    createAudioTrack,
    createBus,
    createFolder,
    createVca,
    finalizeTemplate,
    initProject,
    setMasterChain,
} from '../templateHelpers/builder';

export async function createPodcastTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Podcast',
        bpm: 120,
        timeSig: [4, 4],
        keyRoot: 0,
        scaleName: 'chromatic',
        loopEnd: totalBeats,
    });

    const voiceBus = createBus({
        name: 'Voice Bus',
        devices: [
            {
                type: 'builtin-compressor',
                name: 'Broadcast Comp',
                params: {
                    'comp-threshold': -18,
                    'comp-ratio': 4,
                    'comp-attack': 5,
                    'comp-release': 100,
                    'comp-knee': 6,
                    'comp-makeup': 3,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Broadcast EQ',
                params: {
                    'eq-low-gain': -2,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 2,
                    'eq-mid-freq': 3000,
                    'eq-mid-q': 1,
                    'eq-high-gain': 1.5,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
            { type: 'builtin-limiter', name: 'Voice Limit', params: { 'lim-threshold': -3, 'lim-release': 80 } },
        ],
    });
    const musicBus = createBus({
        name: 'Music Bus',
        devices: [
            {
                type: 'builtin-eq',
                name: 'Music EQ',
                params: {
                    'eq-low-gain': 0,
                    'eq-low-freq': 100,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 1000,
                    'eq-mid-q': 1,
                    'eq-high-gain': 0.5,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const musicSidechainId = attachSidechainCompressor({
        track: musicBus,
        name: 'Music Duck',
        threshold: -28,
        ratio: 4,
        attack: 25,
        release: 250,
        knee: 8,
        makeup: 0,
    });

    const voiceFolder = createFolder({ name: 'Voice' });
    const hostMic = createAudioTrack({
        name: 'Host Mic',
        parentId: voiceFolder.id,
        devices: [
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-eq',
                name: 'Mic EQ',
                params: {
                    'eq-low-gain': -3,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1.5,
                    'eq-mid-freq': 3200,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Mic Comp',
                params: {
                    'comp-threshold': -20,
                    'comp-ratio': 3,
                    'comp-attack': 5,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 3,
                },
            },
            { type: 'builtin-gain', name: 'Trim', params: { 'gain-amount': 0 } },
        ],
    });
    const guest1Mic = createAudioTrack({
        name: 'Guest 1 Mic',
        parentId: voiceFolder.id,
        devices: [
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-eq',
                name: 'Mic EQ',
                params: {
                    'eq-low-gain': -3,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1.5,
                    'eq-mid-freq': 3200,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Mic Comp',
                params: {
                    'comp-threshold': -20,
                    'comp-ratio': 3,
                    'comp-attack': 5,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 3,
                },
            },
            { type: 'builtin-gain', name: 'Trim', params: { 'gain-amount': 0 } },
        ],
    });
    const guest2Mic = createAudioTrack({
        name: 'Guest 2 Mic',
        parentId: voiceFolder.id,
        devices: [
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-eq',
                name: 'Mic EQ',
                params: {
                    'eq-low-gain': -3,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1.5,
                    'eq-mid-freq': 3200,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Mic Comp',
                params: {
                    'comp-threshold': -20,
                    'comp-ratio': 3,
                    'comp-attack': 5,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 3,
                },
            },
            { type: 'builtin-gain', name: 'Trim', params: { 'gain-amount': 0 } },
        ],
    });
    for (const mic of [hostMic, guest1Mic, guest2Mic]) {
        addSend({ from: mic, to: voiceBus, level: 0.95 });
    }

    const musicFolder = createFolder({ name: 'Music' });
    const introMusic = createAudioTrack({ name: 'Intro Music', parentId: musicFolder.id });
    const outroMusic = createAudioTrack({ name: 'Outro Music', parentId: musicFolder.id });
    const sting = createAudioTrack({ name: 'Sting', parentId: musicFolder.id });
    for (const music of [introMusic, outroMusic, sting]) {
        addSend({ from: music, to: musicBus, level: 0.9 });
    }

    const sfxFolder = createFolder({ name: 'SFX' });
    const transitions = createAudioTrack({ name: 'Transitions', parentId: sfxFolder.id });

    const voicesVca = createVca({ name: 'Voices VCA', members: [hostMic, guest1Mic, guest2Mic] });
    const musicVca = createVca({ name: 'Music VCA', members: [introMusic, outroMusic, sting] });

    addSections([
        { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 8, endBeat: 24, name: 'Interview', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 24, endBeat: 40, name: 'Discussion', color: 'oklch(0.40 0.08 150)' },
        { startBeat: 40, endBeat: 48, name: 'Break', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 48, endBeat: totalBeats, name: 'Conclusion', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 8, name: 'Interview' },
        { beat: 24, name: 'Discussion' },
        { beat: 40, name: 'Break' },
        { beat: 48, name: 'Conclusion' },
    ]);

    setMasterChain(masterTrack, 'podcast');

    const tracks = [
        masterTrack,
        voiceBus,
        musicBus,
        voiceFolder,
        hostMic,
        guest1Mic,
        guest2Mic,
        musicFolder,
        introMusic,
        outroMusic,
        sting,
        sfxFolder,
        transitions,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: hostMic.id,
        vcaGroups: [voicesVca, musicVca],
        sidechainRoutes: [{ trigger: hostMic, target: musicBus, deviceId: musicSidechainId }],
    });
}
