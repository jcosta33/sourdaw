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

export async function createAmbientTemplate(): Promise<void> {
    const totalBeats = 128;
    const masterTrack = initProject({
        name: 'Ambient',
        bpm: 60,
        timeSig: [4, 4],
        keyRoot: 0,
        scaleName: 'lydian',
        loopEnd: totalBeats,
    });

    const cathedralReverb = createBus({
        name: 'Cathedral Reverb',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Cathedral',
                params: { 'rev-size': 0.98, 'rev-decay': 8, 'rev-damping': 0.15, 'rev-predelay': 40, 'rev-mix': 1 },
            },
        ],
    });
    const ambientTapeDelay = createBus({
        name: 'Tape Delay',
        devices: [
            { type: 'faust-tape-delay', name: 'Tape Delay', params: { delay: 0.75, feedback: 0.55, dry_wet: 1 } },
        ],
    });
    const springReverb = createBus({
        name: 'Spring Reverb',
        devices: [{ type: 'faust-spring-reverb', name: 'Spring', params: {} }],
    });

    const dronesFolder = createFolder({ name: 'Drones' });
    const subDrone = createInstrumentTrack({
        name: 'Sub Drone',
        parentId: dronesFolder.id,
        deviceType: 'fermenter',
        deviceName: 'Dark Drone',
    });
    const midDrone = createInstrumentTrack({
        name: 'Mid Drone',
        parentId: dronesFolder.id,
        deviceType: 'fermenter',
        deviceName: 'Ambient Drone',
    });
    const airDrone = createInstrumentTrack({
        name: 'Air',
        parentId: dronesFolder.id,
        deviceType: 'fermenter',
        deviceName: 'Ethereal',
    });
    for (const drone of [subDrone, midDrone, airDrone]) {
        addSend({ from: drone, to: cathedralReverb, level: 0.55 });
        addSend({ from: drone, to: ambientTapeDelay, level: 0.25 });
    }

    const padsFolder = createFolder({ name: 'Pads' });
    const warmPad = createInstrumentTrack({
        name: 'Warm Pad',
        parentId: padsFolder.id,
        deviceType: 'levain',
        deviceName: 'Warm Pad',
    });
    const shimmerPad = createInstrumentTrack({
        name: 'Shimmer Pad',
        parentId: padsFolder.id,
        deviceType: 'factory-faust-fm-pad',
        deviceName: 'Shimmer',
    });
    addSend({ from: warmPad, to: cathedralReverb, level: 0.6 });
    addSend({ from: warmPad, to: ambientTapeDelay, level: 0.3 });
    addSend({ from: shimmerPad, to: cathedralReverb, level: 0.65 });
    addSend({ from: shimmerPad, to: ambientTapeDelay, level: 0.35 });

    const melodicFolder = createFolder({ name: 'Melodic' });
    const bell = createInstrumentTrack({
        name: 'Bell',
        parentId: melodicFolder.id,
        deviceType: 'factory-faust-fm-dx-bells',
        deviceName: 'DX Bells',
    });
    const ambientPiano = createInstrumentTrack({
        name: 'Keys',
        parentId: melodicFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Soft Keys',
        deviceParams: { waveform: 1, attack: 0.04, release: 0.8, filterCutoff: 2600, gain: 0.32 },
    });
    const granular = createInstrumentTrack({
        name: 'Granular',
        parentId: melodicFolder.id,
        deviceType: 'builtin-crumbs',
        deviceName: 'Granular',
    });
    addSend({ from: bell, to: cathedralReverb, level: 0.65 });
    addSend({ from: bell, to: ambientTapeDelay, level: 0.4 });
    addSend({ from: ambientPiano, to: cathedralReverb, level: 0.55 });
    addSend({ from: ambientPiano, to: springReverb, level: 0.25 });
    addSend({ from: granular, to: cathedralReverb, level: 0.5 });
    addSend({ from: granular, to: ambientTapeDelay, level: 0.4 });

    const textureFolder = createFolder({ name: 'Texture' });
    const tapeHiss = createAudioTrack({ name: 'Tape Hiss', parentId: textureFolder.id });

    addDeviceChain(subDrone, [
        {
            type: 'builtin-filter',
            name: 'LP',
            params: { 'filter-cutoff': 400, 'filter-resonance': 1, 'filter-type': 0 },
        },
    ]);
    addDeviceChain(midDrone, [
        {
            type: 'builtin-stereo-widener',
            name: 'Widener',
            params: { 'width-amount': 1.5, 'width-mid': 0, 'width-side': 2.5, 'width-mono-bass': 150 },
        },
    ]);

    const dronesVca = createVca({ name: 'Drones VCA', members: [subDrone, midDrone, airDrone] });
    const padsVca = createVca({ name: 'Pads VCA', members: [warmPad, shimmerPad] });
    const melodicVca = createVca({ name: 'Melodic VCA', members: [bell, ambientPiano, granular] });

    setChordProgression({
        chords: [
            { root: 0, quality: '9', duration: 32 },
            { root: 5, quality: 'maj7', duration: 32 },
            { root: 9, quality: 'min9', duration: 32 },
            { root: 7, quality: '7', duration: 32 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 32, name: 'Dawn', color: 'oklch(0.38 0.08 70)' },
        { startBeat: 32, endBeat: 64, name: 'Horizon', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 64, endBeat: 96, name: 'Drift', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 96, endBeat: totalBeats, name: 'Dusk', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Dawn' },
        { beat: 32, name: 'Horizon' },
        { beat: 64, name: 'Drift' },
        { beat: 96, name: 'Dusk' },
    ]);

    setMasterChain(masterTrack, 'ambient');

    const tracks = [
        masterTrack,
        cathedralReverb,
        ambientTapeDelay,
        springReverb,
        dronesFolder,
        subDrone,
        midDrone,
        airDrone,
        padsFolder,
        warmPad,
        shimmerPad,
        melodicFolder,
        bell,
        ambientPiano,
        granular,
        textureFolder,
        tapeHiss,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: warmPad.id,
        vcaGroups: [dronesVca, padsVca, melodicVca],
    });
}
