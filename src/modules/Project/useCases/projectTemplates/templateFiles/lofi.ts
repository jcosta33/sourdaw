import { addDeviceChain } from '../templateHelpers/addDeviceChain';
import { addMarkers } from '../templateHelpers/addMarkers';
import { addSections } from '../templateHelpers/addSections';
import { addSend } from '../templateHelpers/addSend';
import { createAudioTrack } from '../templateHelpers/createAudioTrack';
import { createBus } from '../templateHelpers/createBus';
import { createFolder } from '../templateHelpers/createFolder';
import { createInstrumentTrack } from '../templateHelpers/createInstrumentTrack';
import { createVca } from '../templateHelpers/createVca';
import { finalizeTemplate } from '../templateHelpers/finalizeTemplate';
import { initProject } from '../templateHelpers/initProject';
import { setChordProgression } from '../templateHelpers/setChordProgression';
import { setGroove } from '../templateHelpers/setGroove';
import { setMasterChain } from '../templateHelpers/setMasterChain';

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

    // Instrument chain inlined from factory preset 'factory-bass-sub' (bassPresets).
    const lofiBass = createInstrumentTrack({
        name: 'Bass',
        deviceType: 'builtin-synth',
        deviceName: 'Sub Bass',
        deviceParams: {
            waveform: 0,
            attack: 0.01,
            decay: 0.1,
            sustain: 0.9,
            release: 0.4,
            filterCutoff: 200,
            filterResonance: 0,
            filterType: 0,
            detune: 0,
            gain: 0.4,
            subOscLevel: 0.6,
        },
        extraDevices: [
            {
                type: 'builtin-compressor',
                name: 'Compressor',
                params: {
                    'comp-threshold': -18,
                    'comp-ratio': 4,
                    'comp-attack': 10,
                    'comp-release': 100,
                    'comp-makeup': 0,
                },
            },
            {
                type: 'builtin-eq',
                name: 'EQ',
                params: {
                    'eq-low-gain': 4,
                    'eq-low-freq': 60,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 1000,
                    'eq-mid-q': 1,
                    'eq-high-gain': -6,
                    'eq-high-freq': 8000,
                },
            },
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
    // Instrument chain inlined from factory preset 'factory-faust-rhodes-ambient' (faustInstrumentPresets).
    const lofiRhodes = createInstrumentTrack({
        name: 'Rhodes',
        parentId: melodicFolder.id,
        deviceType: 'faust-rhodes',
        deviceName: 'Ambient Rhodes',
        deviceParams: { brightness: 0.2, body_decay: 4.0, bell_decay: 0.05, gain: 0.35 },
        extraDevices: [
            { type: 'faust-zita-rev1-reverb', name: 'Ambient', params: { decay_time: 8, damping: 6000, dry_wet: 0.6 } },
            { type: 'faust-tape-delay', name: 'Delay', params: { delay: 0.5, feedback: 0.4, dry_wet: 0.25 } },
        ],
    });
    // Instrument chain inlined from factory preset 'factory-keys-pluck' (keysPresets).
    const samplerPluck = createInstrumentTrack({
        name: 'Sampler Pluck',
        parentId: melodicFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Pluck',
        deviceParams: {
            waveform: 1,
            attack: 0.001,
            decay: 0.15,
            sustain: 0.1,
            release: 0.1,
            filterCutoff: 2000,
            filterResonance: 1,
            filterType: 0,
            filterEnvAmount: 5000,
            detune: 0,
            gain: 0.3,
            noiseLevel: 0.1,
        },
        extraDevices: [
            {
                type: 'builtin-reverb',
                name: 'Room',
                params: { 'rev-size': 0.3, 'rev-decay': 1.2, 'rev-damping': 0.5, 'rev-mix': 0.2 },
            },
            {
                type: 'builtin-chorus',
                name: 'Chorus',
                params: { 'chorus-rate': 0.8, 'chorus-depth': 4, 'chorus-feedback': 0.2, 'chorus-mix': 0.2 },
            },
        ],
    });
    // Instrument chain inlined from factory preset 'factory-pad-warm' (padPresets).
    const lofiPad = createInstrumentTrack({
        name: 'Pad',
        parentId: melodicFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Warm Pad',
        deviceParams: {
            waveform: 2,
            attack: 0.5,
            decay: 0.5,
            sustain: 0.8,
            release: 2.0,
            filterCutoff: 2000,
            filterResonance: 0.5,
            filterType: 0,
            detune: 5,
            gain: 0.25,
            osc2Waveform: 2,
            osc2Mix: 0.5,
            osc2Detune: 7,
            noiseLevel: 0.05,
            stereoSpread: 0.7,
            vibratoRate: 3.5,
            vibratoDepth: 8,
            vibratoDelay: 1.0,
        },
        extraDevices: [
            {
                type: 'builtin-reverb',
                name: 'Reverb',
                params: { 'rev-size': 0.8, 'rev-decay': 5, 'rev-damping': 0.4, 'rev-mix': 0.5 },
            },
        ],
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
    // Instrument chain inlined from factory preset 'factory-pad-dark' (padPresets).
    const wobblePad = createInstrumentTrack({
        name: 'Wobble Pad',
        parentId: textureFolder.id,
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
