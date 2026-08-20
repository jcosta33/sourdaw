import { replaceTempoMap, replaceTimeSignatureMap } from '#/modules/Transport/useCases';

import { addDeviceChain } from '../templateHelpers/addDeviceChain';
import { addMarkers } from '../templateHelpers/addMarkers';
import { addSections } from '../templateHelpers/addSections';
import { addSend } from '../templateHelpers/addSend';
import { createBus } from '../templateHelpers/createBus';
import { createFolder } from '../templateHelpers/createFolder';
import { createInstrumentTrack } from '../templateHelpers/createInstrumentTrack';
import { createVca } from '../templateHelpers/createVca';
import { finalizeTemplate } from '../templateHelpers/finalizeTemplate';
import { initProject } from '../templateHelpers/initProject';
import { setChordProgression } from '../templateHelpers/setChordProgression';
import { setMasterChain } from '../templateHelpers/setMasterChain';

export async function createCinematicTemplate(): Promise<void> {
    const totalBeats = 96;
    const masterTrack = initProject({
        name: 'Cinematic',
        bpm: 90,
        timeSig: [4, 4],
        keyRoot: 2,
        scaleName: 'minor',
        loopEnd: totalBeats,
    });

    replaceTimeSignatureMap({
        changes: [
            { beat: 0, numerator: 4, denominator: 4 },
            { beat: 48, numerator: 6, denominator: 8 },
            { beat: 72, numerator: 4, denominator: 4 },
        ],
    });
    replaceTempoMap({
        changes: [
            { beat: 0, tempo: 90, curve: 'instant' },
            { beat: 88, tempo: 72, curve: 'linear' },
        ],
    });

    const hallReverb = createBus({
        name: 'Hall Reverb',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Large Hall',
                params: { 'rev-size': 0.95, 'rev-decay': 6, 'rev-damping': 0.2, 'rev-mix': 1 },
            },
        ],
    });
    const plateReverb = createBus({
        name: 'Plate Reverb',
        devices: [{ type: 'faust-zita-rev1-reverb', name: 'Plate', params: { dry_wet: 1 } }],
    });
    const roomDelay = createBus({
        name: 'Room Delay',
        devices: [{ type: 'faust-tape-delay', name: 'Room Echo', params: { delay: 0.5, feedback: 0.3, dry_wet: 1 } }],
    });

    const stringsFolder = createFolder({ name: 'Strings' });
    const stringsHigh = createInstrumentTrack({
        name: 'Strings High',
        parentId: stringsFolder.id,
        deviceType: 'levain',
        deviceName: 'Strings High',
    });
    const stringsMid = createInstrumentTrack({
        name: 'Strings Mid',
        parentId: stringsFolder.id,
        deviceType: 'levain',
        deviceName: 'Strings Mid',
    });
    const stringsLow = createInstrumentTrack({
        name: 'Strings Low',
        parentId: stringsFolder.id,
        deviceType: 'levain',
        deviceName: 'Strings Low',
    });
    const cello = createInstrumentTrack({
        name: 'Cello',
        parentId: stringsFolder.id,
        deviceType: 'levain',
        deviceName: 'Cello',
    });
    for (const strings of [stringsHigh, stringsMid, stringsLow, cello]) {
        addSend({ from: strings, to: hallReverb, level: 0.5 });
        addSend({ from: strings, to: plateReverb, level: 0.25 });
    }

    const brassFolder = createFolder({ name: 'Brass' });
    const brassLead = createInstrumentTrack({
        name: 'Brass Lead',
        parentId: brassFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Brass',
        deviceParams: { waveform: 2, attack: 0.04, release: 0.3, filterCutoff: 3200, filterResonance: 1.5, gain: 0.45 },
    });
    const frenchHorn = createInstrumentTrack({
        name: 'French Horn',
        parentId: brassFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Horn',
        deviceParams: { waveform: 1, attack: 0.08, release: 0.4, filterCutoff: 2600, gain: 0.4 },
    });
    addSend({ from: brassLead, to: hallReverb, level: 0.55 });
    addSend({ from: frenchHorn, to: hallReverb, level: 0.5 });
    addSend({ from: frenchHorn, to: roomDelay, level: 0.2 });

    const woodwindsFolder = createFolder({ name: 'Woodwinds' });
    const flute = createInstrumentTrack({
        name: 'Flute',
        parentId: woodwindsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Flute',
        deviceParams: {
            waveform: 0,
            attack: 0.06,
            release: 0.35,
            filterCutoff: 4200,
            vibratoRate: 4,
            vibratoDepth: 10,
            gain: 0.35,
        },
    });
    const clarinet = createInstrumentTrack({
        name: 'Clarinet',
        parentId: woodwindsFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Clarinet',
        deviceParams: { waveform: 1, attack: 0.05, release: 0.3, filterCutoff: 2500, gain: 0.35 },
    });
    addSend({ from: flute, to: hallReverb, level: 0.45 });
    addSend({ from: clarinet, to: hallReverb, level: 0.45 });

    const piano = createInstrumentTrack({
        name: 'Keys',
        deviceType: 'builtin-synth',
        deviceName: 'Soft Keys',
        deviceParams: { waveform: 1, attack: 0.02, release: 0.45, filterCutoff: 3200, gain: 0.4 },
    });
    addSend({ from: piano, to: plateReverb, level: 0.35 });
    addSend({ from: piano, to: hallReverb, level: 0.25 });

    const percussionFolder = createFolder({ name: 'Percussion' });
    const cineKick = createInstrumentTrack({
        name: 'Cinematic Kick',
        parentId: percussionFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Acoustic',
        deviceParams: { kit: 3, gain: 0.9 },
    });
    const cineSnare = createInstrumentTrack({
        name: 'Snare',
        parentId: percussionFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Acoustic',
        deviceParams: { kit: 3, gain: 0.8 },
    });
    const cymbal = createInstrumentTrack({
        name: 'Cymbal',
        parentId: percussionFolder.id,
        deviceType: 'builtin-drum-kit',
        deviceName: 'Acoustic',
        deviceParams: { kit: 3, gain: 0.75 },
    });
    const timpani = createInstrumentTrack({
        name: 'Timpani',
        parentId: percussionFolder.id,
        deviceType: 'builtin-synth',
        deviceName: 'Timpani',
        deviceParams: { waveform: 1, attack: 0.005, release: 1.2, filterCutoff: 1500, gain: 0.55 },
    });
    for (const perc of [cineKick, cineSnare, cymbal, timpani]) {
        addSend({ from: perc, to: hallReverb, level: 0.35 });
    }

    addDeviceChain(cineSnare, [
        {
            type: 'builtin-eq',
            name: 'Snare EQ',
            params: {
                'eq-low-gain': 0,
                'eq-low-freq': 180,
                'eq-low-q': 0.9,
                'eq-mid-gain': 1.5,
                'eq-mid-freq': 2500,
                'eq-mid-q': 1,
                'eq-high-gain': 2,
                'eq-high-freq': 8000,
                'eq-high-q': 0.7,
            },
        },
    ]);

    const stringsVca = createVca({ name: 'Strings VCA', members: [stringsHigh, stringsMid, stringsLow, cello] });
    const brassVca = createVca({ name: 'Brass VCA', members: [brassLead, frenchHorn] });
    const windsVca = createVca({ name: 'Winds VCA', members: [flute, clarinet] });
    const pianoVca = createVca({ name: 'Piano VCA', members: [piano] });
    const percVca = createVca({ name: 'Percussion VCA', members: [cineKick, cineSnare, cymbal, timpani] });

    setChordProgression({
        chords: [
            { root: 2, quality: 'minor', duration: 16 },
            { root: 10, quality: 'maj7', duration: 16 },
            { root: 7, quality: 'minor', duration: 16 },
            { root: 9, quality: '7', duration: 16 },
        ],
        repeatUntilBeat: totalBeats,
    });

    addSections([
        { startBeat: 0, endBeat: 16, name: 'Opening', color: 'oklch(0.38 0.08 270)' },
        { startBeat: 16, endBeat: 40, name: 'Theme', color: 'oklch(0.40 0.07 200)' },
        { startBeat: 40, endBeat: 64, name: 'Development', color: 'oklch(0.38 0.08 300)' },
        { startBeat: 64, endBeat: 84, name: 'Climax', color: 'oklch(0.38 0.09 20)' },
        { startBeat: 84, endBeat: totalBeats, name: 'Coda', color: 'oklch(0.38 0.08 270)' },
    ]);
    addMarkers([
        { beat: 0, name: 'Opening' },
        { beat: 16, name: 'Theme' },
        { beat: 40, name: 'Development' },
        { beat: 48, name: '6/8 Bridge' },
        { beat: 64, name: 'Climax' },
        { beat: 72, name: '4/4 Return' },
        { beat: 84, name: 'Coda' },
    ]);

    setMasterChain(masterTrack, 'cinematic');

    const tracks = [
        masterTrack,
        hallReverb,
        plateReverb,
        roomDelay,
        stringsFolder,
        stringsHigh,
        stringsMid,
        stringsLow,
        cello,
        brassFolder,
        brassLead,
        frenchHorn,
        woodwindsFolder,
        flute,
        clarinet,
        piano,
        percussionFolder,
        cineKick,
        cineSnare,
        cymbal,
        timpani,
    ];

    await finalizeTemplate({
        tracks,
        selectTrackId: piano.id,
        vcaGroups: [stringsVca, brassVca, windsVca, pianoVca, percVca],
    });
}
