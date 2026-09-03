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
import { setGroove } from '../templateHelpers/setGroove';
import { setMasterChain } from '../templateHelpers/setMasterChain';

export async function createPopSongTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Pop Song',
        bpm: 100,
        timeSig: [4, 4],
        keyRoot: 0,
        scaleName: 'major',
        loopEnd: totalBeats,
    });

    setGroove({
        id: 'pop-subtle-swing',
        name: 'Subtle Pop Swing',
        offsets: [0, 0.02, 0, 0.02],
        resolution: 0.25,
        intensity: 0.25,
    });

    const drumBus = createBus({
        name: 'Drum Bus',
        devices: [
            {
                type: 'gluten',
                name: 'Drum Glue',
                params: {
                    topology: 3,
                    amount: 40,
                    threshold: -14,
                    ratio: 2,
                    attack: 20,
                    release: 140,
                    knee: 6,
                    makeup: 0,
                    mix: 1,
                    autoMakeup: 1,
                    autoRelease: 1,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Drum Shape',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 70,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1,
                    'eq-mid-freq': 400,
                    'eq-mid-q': 1.2,
                    'eq-high-gain': 1.5,
                    'eq-high-freq': 9000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const vocalBus = createBus({
        name: 'Vocal Bus',
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
                    'eq-low-gain': -1.5,
                    'eq-low-freq': 120,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 1,
                    'eq-mid-freq': 3000,
                    'eq-mid-q': 1,
                    'eq-high-gain': 2,
                    'eq-high-freq': 11000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const reverbShort = createBus({
        name: 'Reverb Short (Plate)',
        devices: [{ type: 'faust-zita-rev1-reverb', name: 'Plate', params: { dry_wet: 1, fb1: 0.45, fb2: 0.4 } }],
    });
    const reverbLong = createBus({
        name: 'Reverb Long (Hall)',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Hall',
                params: { 'rev-size': 0.85, 'rev-decay': 4, 'rev-damping': 0.3, 'rev-mix': 1 },
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
    const kick = createInstrumentTrack({
        name: 'Kick',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Pop Kit',
        deviceParams: { kit: 3, gain: 0.9 },
    });
    const snare = createInstrumentTrack({
        name: 'Snare',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Pop Kit',
        deviceParams: { kit: 3, gain: 0.85 },
    });
    const hat = createInstrumentTrack({
        name: 'Hat',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Pop Kit',
        deviceParams: { kit: 3, gain: 0.7 },
    });
    const perc = createInstrumentTrack({
        name: 'Perc',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Pop Kit',
        deviceParams: { kit: 3, gain: 0.6 },
    });
    for (const drum of [kick, snare, hat, perc]) {
        addSend({ from: drum, to: drumBus, level: 0.9 });
    }
    addSend({ from: snare, to: reverbShort, level: 0.3 });
    addSend({ from: perc, to: reverbShort, level: 0.25 });

    const bass = createInstrumentTrack({
        name: 'Bass',
        deviceType: 'builtin-synth',
        deviceName: 'Sub Bass',
        deviceParams: { waveform: 0, attack: 0.005, release: 0.2, subOscLevel: 0.6, gain: 0.45 },
        extraDevices: [
            {
                type: 'builtin-eq',
                name: 'Bass EQ',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1,
                    'eq-mid-freq': 250,
                    'eq-mid-q': 1,
                    'eq-high-gain': 0,
                    'eq-high-freq': 8000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Bass Comp',
                params: {
                    'comp-threshold': -14,
                    'comp-ratio': 3,
                    'comp-attack': 5,
                    'comp-release': 120,
                    'comp-knee': 6,
                    'comp-makeup': 2,
                },
            },
        ],
    });
    const bassSidechainId = attachSidechainCompressor({
        track: bass,
        name: 'SC Duck',
        threshold: -22,
        ratio: 4,
        attack: 2,
        release: 140,
    });

    const rhythmFolder = createFolder({ name: 'Rhythm' });
    const rhythmGtr = createInstrumentTrack({
        name: 'Rhythm Gtr',
        parentId: rhythmFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Chord Pad',
        deviceParams: { waveform: 2, attack: 0.1, release: 0.4, filterCutoff: 3200, stereoSpread: 0.7, gain: 0.35 },
        extraDevices: [
            {
                type: 'builtin-chorus',
                name: 'Chorus',
                params: { 'chorus-rate': 0.4, 'chorus-depth': 4, 'chorus-feedback': 0.12, 'chorus-mix': 0.25 },
            },
        ],
    });
    // Instrument chain inlined from factory preset 'factory-faust-rhodes-ambient' (faustInstrumentPresets).
    const rhodes = createInstrumentTrack({
        name: 'Rhodes',
        parentId: rhythmFolder.id,
        deviceType: 'faust-rhodes',
        deviceName: 'Ambient Rhodes',
        deviceParams: { brightness: 0.2, body_decay: 4.0, bell_decay: 0.05, gain: 0.35 },
        extraDevices: [
            { type: 'faust-zita-rev1-reverb', name: 'Ambient', params: { decay_time: 8, damping: 6000, dry_wet: 0.6 } },
            { type: 'faust-tape-delay', name: 'Delay', params: { delay: 0.5, feedback: 0.4, dry_wet: 0.25 } },
        ],
    });
    addSend({ from: rhythmGtr, to: reverbShort, level: 0.25 });
    addSend({ from: rhodes, to: reverbShort, level: 0.3 });
    addSend({ from: rhodes, to: tapeDelay, level: 0.2 });

    const leadsFolder = createFolder({ name: 'Leads & Vocals' });
    const leadVocal = createInstrumentTrack({
        name: 'Lead Vocal',
        parentId: leadsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Vocal Synth',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.3, filterCutoff: 4500, gain: 0.4 },
        extraDevices: [{ type: 'knead', name: 'Pitch Correct', params: {} }],
    });
    const backupVocal = createInstrumentTrack({
        name: 'Backup Vocal',
        parentId: leadsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Harmony',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.3, filterCutoff: 4500, gain: 0.3 },
    });
    addSend({ from: leadVocal, to: vocalBus, level: 0.95 });
    addSend({ from: backupVocal, to: vocalBus, level: 0.9 });
    addSend({ from: leadVocal, to: reverbLong, level: 0.25 });
    addSend({ from: leadVocal, to: tapeDelay, level: 0.2 });
    addSend({ from: backupVocal, to: reverbLong, level: 0.3 });

    // Instrument chain inlined from factory preset 'factory-pad-warm' (padPresets).
    const pad = createInstrumentTrack({
        name: 'Pad',
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
    addSend({ from: pad, to: reverbLong, level: 0.4 });
    addDeviceChain(pad, [
        {
            type: 'builtin-reverb',
            name: 'Pad Verb',
            params: { 'rev-size': 0.85, 'rev-decay': 4, 'rev-damping': 0.3, 'rev-mix': 0.25 },
        },
    ]);

    const drumsVca = createVca({ name: 'Drums VCA', members: [kick, snare, hat, perc] });
    const melodyVca = createVca({ name: 'Melody VCA', members: [rhythmGtr, rhodes, pad] });
    const vocalsVca = createVca({ name: 'Vocals VCA', members: [leadVocal, backupVocal] });

    setChordProgression({
        chords: [
            { root: 0, quality: 'major', duration: 16 },
            { root: 9, quality: 'minor', duration: 16 },
            { root: 5, quality: 'major', duration: 16 },
            { root: 7, quality: 'major', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 8, endBeat: 24, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 24, endBeat: 40, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 40, endBeat: 52, name: 'Bridge', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 52, endBeat: totalBeats, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 8, name: 'Verse' },
        { beat: 24, name: 'Chorus' },
        { beat: 40, name: 'Bridge' },
        { beat: 52, name: 'Outro' },
    ]);

    setMasterChain(masterTrack, 'pop');

    const tracks = [
        masterTrack,
        drumBus,
        vocalBus,
        reverbShort,
        reverbLong,
        tapeDelay,
        drumFolder,
        kick,
        snare,
        hat,
        perc,
        bass,
        rhythmFolder,
        rhythmGtr,
        rhodes,
        leadsFolder,
        leadVocal,
        backupVocal,
        pad,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: leadVocal.id,
        vcaGroups: [drumsVca, melodyVca, vocalsVca],
        sidechainRoutes: [{ trigger: kick, target: bass, deviceId: bassSidechainId }],
    });
}
