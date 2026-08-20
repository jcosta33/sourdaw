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
import { setMasterChain } from '../templateHelpers/setMasterChain';

export async function createSingerSongwriterTemplate(): Promise<void> {
    const totalBeats = 64;
    const masterTrack = initProject({
        name: 'Singer-Songwriter',
        bpm: 90,
        timeSig: [4, 4],
        keyRoot: 7,
        scaleName: 'major',
        loopEnd: totalBeats,
    });

    const plateShort = createBus({
        name: 'Plate Short',
        devices: [{ type: 'faust-zita-rev1-reverb', name: 'Plate Short', params: { dry_wet: 1 } }],
    });
    const plateLong = createBus({
        name: 'Plate Long',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Long Plate',
                params: { 'rev-size': 0.8, 'rev-decay': 4, 'rev-damping': 0.3, 'rev-mix': 1 },
            },
        ],
    });
    const slapDelay = createBus({
        name: 'Slap Delay',
        devices: [{ type: 'faust-tape-delay', name: 'Slap', params: { delay: 0.12, feedback: 0.15, dry_wet: 1 } }],
    });

    const vocalFolder = createFolder({ name: 'Vocals' });
    const leadVocal = createInstrumentTrack({
        name: 'Lead Vocal',
        parentId: vocalFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Lead Vocal',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.3, filterCutoff: 4800, gain: 0.4 },
        extraDevices: [
            { type: 'knead', name: 'Pitch Correct', params: {} },
            { type: 'builtin-deesser', name: 'De-Ess', params: {} },
            {
                type: 'builtin-compressor',
                name: 'Vox Comp',
                params: {
                    'comp-threshold': -18,
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
                    'eq-low-gain': -1,
                    'eq-low-freq': 100,
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
    const harmonyVocal = createInstrumentTrack({
        name: 'Harmony Vocal',
        parentId: vocalFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Harmony',
        deviceParams: { waveform: 0, attack: 0.02, release: 0.3, filterCutoff: 4500, gain: 0.3 },
    });
    addSend({ from: leadVocal, to: plateShort, level: 0.3 });
    addSend({ from: leadVocal, to: slapDelay, level: 0.2 });
    addSend({ from: harmonyVocal, to: plateLong, level: 0.35 });
    addSend({ from: harmonyVocal, to: slapDelay, level: 0.15 });

    const instrumentsFolder = createFolder({ name: 'Instruments' });
    const acousticGtr = createAudioTrack({
        name: 'Acoustic Gtr',
        parentId: instrumentsFolder.id,
        devices: [
            {
                type: 'builtin-eq',
                name: 'Gtr EQ',
                params: {
                    'eq-low-gain': -1,
                    'eq-low-freq': 120,
                    'eq-low-q': 0.8,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 1500,
                    'eq-mid-q': 1,
                    'eq-high-gain': 1.5,
                    'eq-high-freq': 8000,
                    'eq-high-q': 0.7,
                },
            },
            {
                type: 'builtin-compressor',
                name: 'Gtr Comp',
                params: {
                    'comp-threshold': -16,
                    'comp-ratio': 2.5,
                    'comp-attack': 8,
                    'comp-release': 120,
                    'comp-knee': 8,
                    'comp-makeup': 2,
                },
            },
        ],
    });
    const ssPiano = createInstrumentTrack({
        name: 'Keys',
        parentId: instrumentsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Soft Keys',
        deviceParams: { waveform: 1, attack: 0.02, release: 0.5, filterCutoff: 3000, gain: 0.38 },
    });
    const ssBass = createInstrumentTrack({
        name: 'Bass',
        parentId: instrumentsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Bass',
        deviceParams: { waveform: 2, attack: 0.005, release: 0.25, filterCutoff: 1800, subOscLevel: 0.3, gain: 0.45 },
        extraDevices: [
            {
                type: 'builtin-eq',
                name: 'Bass EQ',
                params: {
                    'eq-low-gain': 2,
                    'eq-low-freq': 90,
                    'eq-low-q': 0.9,
                    'eq-mid-gain': 0,
                    'eq-mid-freq': 500,
                    'eq-mid-q': 1,
                    'eq-high-gain': 0,
                    'eq-high-freq': 6000,
                    'eq-high-q': 0.7,
                },
            },
        ],
    });
    addSend({ from: acousticGtr, to: plateShort, level: 0.3 });
    addSend({ from: acousticGtr, to: slapDelay, level: 0.12 });
    addSend({ from: ssPiano, to: plateLong, level: 0.35 });
    addSend({ from: ssPiano, to: plateShort, level: 0.2 });

    addDeviceChain(harmonyVocal, [
        {
            type: 'builtin-chorus',
            name: 'Harmony Chorus',
            params: { 'chorus-rate': 0.3, 'chorus-depth': 4, 'chorus-feedback': 0.15, 'chorus-mix': 0.2 },
        },
    ]);

    const vocalsVca = createVca({ name: 'Vocals VCA', members: [leadVocal, harmonyVocal] });
    const instrumentsVca = createVca({ name: 'Instruments VCA', members: [acousticGtr, ssPiano, ssBass] });

    setChordProgression({
        chords: [
            { root: 7, quality: 'major', duration: 16 },
            { root: 4, quality: 'minor', duration: 16 },
            { root: 0, quality: 'major', duration: 16 },
            { root: 2, quality: 'major', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 16, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 16, endBeat: 32, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 32, endBeat: 40, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 40, endBeat: 48, name: 'Bridge', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 48, endBeat: totalBeats, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Verse' },
        { beat: 16, name: 'Chorus' },
        { beat: 32, name: 'Verse' },
        { beat: 40, name: 'Bridge' },
        { beat: 48, name: 'Chorus' },
    ]);

    setMasterChain(masterTrack, 'songwriter');

    const tracks = [
        masterTrack,
        plateShort,
        plateLong,
        slapDelay,
        vocalFolder,
        leadVocal,
        harmonyVocal,
        instrumentsFolder,
        acousticGtr,
        ssPiano,
        ssBass,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: leadVocal.id,
        vcaGroups: [vocalsVca, instrumentsVca],
    });
}
