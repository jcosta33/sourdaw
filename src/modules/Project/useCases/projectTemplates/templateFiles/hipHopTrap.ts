import { addDeviceChain } from '../templateHelpers/addDeviceChain';
import { addMarkers } from '../templateHelpers/addMarkers';
import { addSections } from '../templateHelpers/addSections';
import { addSend } from '../templateHelpers/addSend';
import { attachSidechainCompressor } from '../templateHelpers/attachSidechainCompressor';
import { createBus } from '../templateHelpers/createBus';
import { createFolder } from '../templateHelpers/createFolder';
import { createInstrumentTrack } from '../templateHelpers/createInstrumentTrack';
import { createVca } from '../templateHelpers/createVca';
import { finalizeTemplate } from '../templateHelpers/finalizeTemplate';
import { initProject } from '../templateHelpers/initProject';
import { setChordProgression } from '../templateHelpers/setChordProgression';
import { setMasterChain } from '../templateHelpers/setMasterChain';

export async function createHipHopTrapTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Hip-Hop / Trap',
        bpm: 140,
        timeSig: [4, 4],
        keyRoot: 5,
        scaleName: 'minor',
        loopEnd: totalBeats,
    });

    const vocalBus = createBus({
        name: 'Vocal Bus',
        devices: [
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-compressor',
                name: 'Vocal Comp',
                params: {
                    'comp-threshold': -18,
                    'comp-ratio': 4,
                    'comp-attack': 5,
                    'comp-release': 100,
                    'comp-knee': 4,
                    'comp-makeup': 2,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Vocal EQ',
                params: {
                    'eq-low-gain': -2,
                    'eq-low-freq': 100,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1.5,
                    'eq-mid-freq': 3000,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 12000,
                    'eq-high-q': 0.7,
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
                params: { 'rev-size': 0.9, 'rev-decay': 4.5, 'rev-damping': 0.25, 'rev-mix': 1 },
            },
        ],
    });
    const tapeDelay = createBus({
        name: 'Tape Delay',
        devices: [
            { type: 'faust-tape-delay', name: 'Tape Delay', params: { delay: 0.375, feedback: 0.5, dry_wet: 1 } },
        ],
    });

    const drumFolder = createFolder({ name: 'Trap Drums' });
    const kit808 = createInstrumentTrack({
        name: '808 Kit',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Trap',
        deviceParams: { kit: 5, gain: 0.95 },
    });
    const hats = createInstrumentTrack({
        name: 'Hats',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Trap Hats',
        deviceParams: { kit: 5, gain: 0.75 },
    });
    const snareClap = createInstrumentTrack({
        name: 'Snare / Clap',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Trap',
        deviceParams: { kit: 5, gain: 0.85 },
    });
    const drumPerc = createInstrumentTrack({
        name: 'Perc',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Trap Perc',
        deviceParams: { kit: 5, gain: 0.7 },
    });
    addSend({ from: snareClap, to: reverbPlate, level: 0.35 });
    addSend({ from: drumPerc, to: reverbPlate, level: 0.25 });

    const bass808 = createInstrumentTrack({
        name: 'Bass 808',
        deviceType: 'builtin-synth',
        deviceName: '808 Sub',
        deviceParams: { waveform: 0, attack: 0.005, release: 0.5, subOscLevel: 0.8, gain: 0.5 },
        extraDevices: [
            {
                type: 'builtin-eq',
                name: '808 EQ',
                params: {
                    'eq-low-gain': 3,
                    'eq-low-freq': 50,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1,
                    'eq-mid-freq': 300,
                    'eq-mid-q': 1,
                    'eq-high-gain': 0,
                    'eq-high-freq': 6000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-distortion',
                name: 'Sub Sat',
                params: { 'dist-drive': 2, 'dist-tone': 1800, 'dist-mix': 0.2, 'dist-output': -3 },
            },
        ],
    });
    const bassSidechainId = attachSidechainCompressor({
        track: bass808,
        name: 'SC Duck',
        threshold: -18,
        ratio: 8,
        attack: 1,
        release: 160,
        makeup: 2,
    });

    const melodicFolder = createFolder({ name: 'Melodic' });
    // Instrument chain inlined from factory preset 'factory-faust-rhodes-warm' (faustInstrumentPresets).
    const melodicRhodes = createInstrumentTrack({
        name: 'Rhodes',
        parentId: melodicFolder.id,
        deviceType: 'faust-rhodes',
        deviceName: 'Warm Rhodes',
        deviceParams: { brightness: 0.3, body_decay: 2.0, bell_decay: 0.1, gain: 0.5 },
        extraDevices: [
            {
                type: 'builtin-chorus',
                name: 'Chorus',
                params: { 'chorus-rate': 0.8, 'chorus-depth': 5, 'chorus-feedback': 0.2, 'chorus-mix': 0.3 },
            },
            {
                type: 'faust-1176-compressor',
                name: 'Evenness',
                params: { threshold: -18, ratio: 3, attack: 0.008, release: 0.12 },
            },
        ],
    });
    const flute = createInstrumentTrack({
        name: 'Flute Lead',
        parentId: melodicFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Flute',
        deviceParams: {
            waveform: 1,
            attack: 0.05,
            release: 0.4,
            filterCutoff: 3200,
            filterResonance: 2,
            vibratoRate: 5,
            vibratoDepth: 15,
            gain: 0.35,
        },
    });
    // Instrument chain inlined from factory preset 'factory-pad-dark' (padPresets).
    const trapPad = createInstrumentTrack({
        name: 'Pad',
        parentId: melodicFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Dark Pad',
        deviceParams: {
            waveform: 3,
            attack: 0.3,
            decay: 0.4,
            sustain: 0.7,
            release: 1.5,
            filterCutoff: 800,
            filterResonance: 1,
            filterType: 0,
            detune: 3,
            gain: 0.25,
            osc2Waveform: 2,
            osc2Mix: 0.3,
            osc2Detune: -5,
            subOscLevel: 0.2,
        },
        extraDevices: [
            {
                type: 'builtin-reverb',
                name: 'Reverb',
                params: { 'rev-size': 0.6, 'rev-decay': 3, 'rev-damping': 0.6, 'rev-mix': 0.4 },
            },
        ],
    });
    addSend({ from: melodicRhodes, to: reverbHall, level: 0.4 });
    addSend({ from: melodicRhodes, to: tapeDelay, level: 0.3 });
    addSend({ from: flute, to: reverbHall, level: 0.45 });
    addSend({ from: flute, to: tapeDelay, level: 0.35 });
    addSend({ from: trapPad, to: reverbHall, level: 0.3 });

    const vocalFolder = createFolder({ name: 'Vocals' });
    const leadVocal = createInstrumentTrack({
        name: 'Lead Vocal',
        parentId: vocalFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Vocal Synth',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.3, filterCutoff: 4500, gain: 0.4 },
        extraDevices: [{ type: 'knead', name: 'Pitch Correct', params: {} }],
    });
    const adLib = createInstrumentTrack({
        name: 'Ad Lib',
        parentId: vocalFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Ad Lib',
        deviceParams: { waveform: 0, attack: 0.01, release: 0.25, gain: 0.3 },
    });
    const hook = createInstrumentTrack({
        name: 'Hook',
        parentId: vocalFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Hook',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.35, gain: 0.4 },
        extraDevices: [{ type: 'knead', name: 'Pitch Correct', params: {} }],
    });
    for (const vox of [leadVocal, adLib, hook]) {
        addSend({ from: vox, to: vocalBus, level: 0.95 });
    }
    addSend({ from: leadVocal, to: reverbPlate, level: 0.25 });
    addSend({ from: leadVocal, to: tapeDelay, level: 0.25 });
    addSend({ from: adLib, to: reverbPlate, level: 0.4 });
    addSend({ from: adLib, to: tapeDelay, level: 0.35 });
    addSend({ from: hook, to: reverbPlate, level: 0.3 });
    addSend({ from: hook, to: reverbHall, level: 0.3 });

    addDeviceChain(trapPad, [
        {
            type: 'builtin-reverb',
            name: 'Pad Verb',
            params: { 'rev-size': 0.85, 'rev-decay': 4, 'rev-damping': 0.3, 'rev-mix': 0.3 },
        },
    ]);

    const drumsVca = createVca({ name: 'Drums VCA', members: [kit808, hats, snareClap, drumPerc] });
    const bassVca = createVca({ name: 'Bass VCA', members: [bass808] });
    const melodyVca = createVca({ name: 'Melody VCA', members: [melodicRhodes, flute, trapPad] });
    const vocalsVca = createVca({ name: 'Vocals VCA', members: [leadVocal, adLib, hook] });

    setChordProgression({
        chords: [
            { root: 5, quality: 'minor', duration: 16 },
            { root: 1, quality: 'major', duration: 16 },
            { root: 10, quality: 'minor', duration: 16 },
            { root: 3, quality: 'major', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 8, endBeat: 24, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 24, endBeat: 40, name: 'Hook', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 40, endBeat: 48, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 48, endBeat: totalBeats, name: 'Hook', color: 'oklch(0.38 0.09 20)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 8, name: 'Verse' },
        { beat: 24, name: 'Hook' },
        { beat: 40, name: 'Verse' },
        { beat: 48, name: 'Hook' },
    ]);

    setMasterChain(masterTrack, 'hiphop');

    const tracks = [
        masterTrack,
        vocalBus,
        reverbPlate,
        reverbHall,
        tapeDelay,
        drumFolder,
        kit808,
        hats,
        snareClap,
        drumPerc,
        bass808,
        melodicFolder,
        melodicRhodes,
        flute,
        trapPad,
        vocalFolder,
        leadVocal,
        adLib,
        hook,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: leadVocal.id,
        vcaGroups: [drumsVca, bassVca, melodyVca, vocalsVca],
        sidechainRoutes: [{ trigger: kit808, target: bass808, deviceId: bassSidechainId }],
    });
}
