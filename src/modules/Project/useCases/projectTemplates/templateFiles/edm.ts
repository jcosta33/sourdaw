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

export async function createEdmTemplate(): Promise<void> {
    const totalBeats = 128;
    const masterTrack = initProject({
        name: 'EDM',
        bpm: 128,
        timeSig: [4, 4],
        keyRoot: 0,
        scaleName: 'minor',
        loopEnd: totalBeats,
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
                name: 'Big Hall',
                params: { 'rev-size': 0.95, 'rev-decay': 5, 'rev-damping': 0.2, 'rev-mix': 1 },
            },
        ],
    });
    const tapeDelay = createBus({
        name: 'Tape Delay',
        devices: [
            { type: 'faust-tape-delay', name: 'Tape Delay', params: { delay: 0.1875, feedback: 0.45, dry_wet: 1 } },
        ],
    });
    const parallelComp = createBus({
        name: 'Parallel Comp',
        devices: [
            {
                type: 'builtin-compressor',
                name: 'NY Comp',
                params: {
                    'comp-threshold': -30,
                    'comp-ratio': 10,
                    'comp-attack': 1,
                    'comp-release': 80,
                    'comp-knee': 0,
                    'comp-makeup': 8,
                },
            },
            {
                type: 'builtin-eq',
                name: 'Parallel EQ',
                params: {
                    'eq-low-gain': 3,
                    'eq-low-freq': 80,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -2,
                    'eq-mid-freq': 500,
                    'eq-mid-q': 1.2,
                    'eq-high-gain': 3,
                    'eq-high-freq': 10000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });

    const drumFolder = createFolder({ name: 'Drums' });
    const edmKick = createInstrumentTrack({
        name: 'Kick',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Electronic',
        deviceParams: { kit: 2, gain: 0.95 },
    });
    const edmClap = createInstrumentTrack({
        name: 'Clap',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Electronic',
        deviceParams: { kit: 2, gain: 0.85 },
    });
    const edmHat = createInstrumentTrack({
        name: 'Hat',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Electronic',
        deviceParams: { kit: 2, gain: 0.75 },
    });
    const edmRide = createInstrumentTrack({
        name: 'Ride / Cymbal',
        parentId: drumFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Electronic',
        deviceParams: { kit: 2, gain: 0.6 },
    });
    for (const drum of [edmKick, edmClap, edmHat, edmRide]) {
        addSend({ from: drum, to: parallelComp, level: 0.45 });
    }
    addSend({ from: edmClap, to: reverbPlate, level: 0.35 });
    addSend({ from: edmRide, to: reverbHall, level: 0.3 });

    // Instrument chain inlined from factory preset 'factory-bass-sub' (bassPresets).
    const edmBass = createInstrumentTrack({
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
                    'eq-low-gain': 3,
                    'eq-low-freq': 60,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': -1,
                    'eq-mid-freq': 300,
                    'eq-mid-q': 1,
                    'eq-high-gain': 0,
                    'eq-high-freq': 6000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    const bassSidechainId = attachSidechainCompressor({
        track: edmBass,
        name: 'SC Pump',
        threshold: -20,
        ratio: 8,
        attack: 1,
        release: 120,
        makeup: 3,
    });

    const leadsFolder = createFolder({ name: 'Leads' });
    // Instrument chain inlined from factory preset 'factory-faust-supersaw-pad' (faustInstrumentPresets).
    const supersawLead = createInstrumentTrack({
        name: 'Supersaw Lead',
        parentId: leadsFolder.id,
        deviceType: 'faust-supersaw-unison',
        deviceName: 'Supersaw Pad',
        deviceParams: {
            detune: 30,
            center_mix: 0.4,
            cutoff: 3000,
            resonance: 0.5,
            attack: 0.5,
            decay: 0.5,
            sustain: 0.8,
            release: 3.0,
        },
        extraDevices: [
            { type: 'faust-zita-rev1-reverb', name: 'Space', params: { decay_time: 6, damping: 6000, dry_wet: 0.4 } },
            {
                type: 'builtin-chorus',
                name: 'Width',
                params: { 'chorus-rate': 0.3, 'chorus-depth': 7, 'chorus-feedback': 0.2, 'chorus-mix': 0.25 },
            },
        ],
    });
    // Instrument chain inlined from factory preset 'factory-keys-pluck' (keysPresets).
    const pluck = createInstrumentTrack({
        name: 'Pluck',
        parentId: leadsFolder.id,
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
    const arp = createInstrumentTrack({
        name: 'Arp',
        parentId: leadsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Arp Synth',
        deviceParams: { waveform: 2, attack: 0.005, release: 0.15, filterCutoff: 4000, filterResonance: 4, gain: 0.4 },
        extraDevices: [
            {
                type: 'yeast',
                name: 'Arpeggiator',
                params: { arp_mode: 2, arp_rate: 16, arp_gate: 0.7, arp_swing: 0.1 },
            },
        ],
    });
    addSend({ from: supersawLead, to: reverbHall, level: 0.35 });
    addSend({ from: supersawLead, to: tapeDelay, level: 0.2 });
    addSend({ from: pluck, to: tapeDelay, level: 0.35 });
    addSend({ from: pluck, to: reverbPlate, level: 0.25 });
    addSend({ from: arp, to: tapeDelay, level: 0.4 });
    addSend({ from: arp, to: reverbHall, level: 0.2 });

    const padsFolder = createFolder({ name: 'Pads' });
    // Instrument chain inlined from factory preset 'factory-pad-warm' (padPresets).
    const widePad = createInstrumentTrack({
        name: 'Wide Pad',
        parentId: padsFolder.id,
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
    addDeviceChain(widePad, [
        {
            type: 'builtin-stereo-widener',
            name: 'Widener',
            params: { 'width-amount': 1.4, 'width-mid': 0, 'width-side': 2, 'width-mono-bass': 200 },
        },
    ]);
    const atmos = createInstrumentTrack({
        name: 'Atmos',
        parentId: padsFolder.id,
        deviceType: 'fermenter',
        deviceName: 'Granular Atmos',
    });
    addSend({ from: widePad, to: reverbHall, level: 0.45 });
    addSend({ from: atmos, to: reverbHall, level: 0.5 });

    const padSidechainId = attachSidechainCompressor({
        track: widePad,
        name: 'SC Pump',
        threshold: -22,
        ratio: 5,
        attack: 2,
        release: 160,
        makeup: 2,
    });

    const drumsVca = createVca({ name: 'Drums VCA', members: [edmKick, edmClap, edmHat, edmRide] });
    const bassVca = createVca({ name: 'Bass VCA', members: [edmBass] });
    const leadsVca = createVca({ name: 'Leads VCA', members: [supersawLead, pluck, arp] });
    const padsVca = createVca({ name: 'Pads VCA', members: [widePad, atmos] });

    setChordProgression({
        chords: [
            { root: 0, quality: 'minor', duration: 16 },
            { root: 8, quality: 'major', duration: 16 },
            { root: 3, quality: 'major', duration: 16 },
            { root: 10, quality: 'major', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 16, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 16, endBeat: 48, name: 'Build', color: 'oklch(0.40 0.08 70)' },
        { startBeat: 48, endBeat: 80, name: 'Drop', color: 'oklch(0.38 0.09 0)' },
        { startBeat: 80, endBeat: 96, name: 'Breakdown', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 96, endBeat: 120, name: 'Drop', color: 'oklch(0.38 0.09 0)' },
        { startBeat: 120, endBeat: totalBeats, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Intro' },
        { beat: 16, name: 'Build' },
        { beat: 48, name: 'Drop' },
        { beat: 80, name: 'Breakdown' },
        { beat: 96, name: 'Drop 2' },
        { beat: 120, name: 'Outro' },
    ]);

    setMasterChain(masterTrack, 'edm');

    const tracks = [
        masterTrack,
        reverbPlate,
        reverbHall,
        tapeDelay,
        parallelComp,
        drumFolder,
        edmKick,
        edmClap,
        edmHat,
        edmRide,
        edmBass,
        leadsFolder,
        supersawLead,
        pluck,
        arp,
        padsFolder,
        widePad,
        atmos,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: supersawLead.id,
        vcaGroups: [drumsVca, bassVca, leadsVca, padsVca],
        sidechainRoutes: [
            { trigger: edmKick, target: edmBass, deviceId: bassSidechainId },
            { trigger: edmKick, target: widePad, deviceId: padSidechainId },
        ],
    });
}
