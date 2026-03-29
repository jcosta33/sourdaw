/**
 * Demo 5 — Nebula Drift
 * ~2:00 @ 78 BPM | A minor / modal drift | Tangerine Dream–inspired atmosphere.
 * Palette: Fermenter (beds, motion, texture), Levain (meandering ensemble lines),
 * Toaster (sparse pulse — parent + 6 pad children).
 */
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { projectStore } from '../../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { createTrack, createAutomationLane } from '#/modules/Arrangement/useCases/trackQueries';
import type { MidiNote } from '#/modules/Arrangement/useCases/trackQueries';
import { note, applyPreset, createMidiClip, syncArrangement } from '../demoUtils';

const TB = 156;
const bpm = 78;

const A2 = 45;
const E3 = 52;
const A3 = 57;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const G5 = 79;
const A5 = 81;

function levainDevice(overrides: Record<string, number> = {}) {
    return {
        id: `dev-${crypto.randomUUID()}`,
        name: 'Levain',
        type: 'levain' as const,
        bypassed: false,
        parameterValues: {
            masterGain: 0.88,
            humanize: 0.62,
            vibratoDepth: 0.14,
            legatoEnabled: 1,
            autoDivisi: 0,
            ensembleTiming: 1,
            ...overrides,
        },
    };
}

export async function demo5_NebulaDrift(): Promise<void> {
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    const droneFolder = createTrack({ name: '🌌 Drone Beds', kind: 'folder' });
    const tSubDrone = createTrack({ name: 'Sub Drone', kind: 'midi', parentId: droneFolder.id });
    const tDarkMist = createTrack({ name: 'Dark Mist', kind: 'midi', parentId: droneFolder.id });
    const tGrainHaze = createTrack({ name: 'Grain Haze', kind: 'midi', parentId: droneFolder.id });
    const tEtherealVeil = createTrack({ name: 'Ethereal Veil', kind: 'midi', parentId: droneFolder.id });

    const motionFolder = createTrack({ name: '🔮 Motion & Texture', kind: 'folder' });
    const tSweepHorizon = createTrack({ name: 'Sweep Horizon', kind: 'midi', parentId: motionFolder.id });
    const tWarmHalo = createTrack({ name: 'Warm Halo', kind: 'midi', parentId: motionFolder.id });
    const tRisingMist = createTrack({ name: 'Rising Mist', kind: 'midi', parentId: motionFolder.id });
    const tWildDrift = createTrack({ name: 'Wild Drift', kind: 'midi', parentId: motionFolder.id });

    const levainFolder = createTrack({ name: '🎻 Levain Lines', kind: 'folder' });
    const tLevHigh = createTrack({ name: 'Levain High', kind: 'midi', parentId: levainFolder.id });
    const tLevMid = createTrack({ name: 'Levain Mid', kind: 'midi', parentId: levainFolder.id });
    const tLevLow = createTrack({ name: 'Levain Low', kind: 'midi', parentId: levainFolder.id });
    const tLevCall = createTrack({ name: 'Levain Call', kind: 'midi', parentId: levainFolder.id });
    const tLevAnswer = createTrack({ name: 'Levain Answer', kind: 'midi', parentId: levainFolder.id });

    const pulseFolder = createTrack({ name: '⚡ Pulse (Toaster)', kind: 'folder' });
    const tToasterRig = createTrack({ name: 'Toaster Rig', kind: 'midi', parentId: pulseFolder.id });
    const tPad0 = createTrack({ name: 'P0 — Kick', kind: 'midi', parentId: pulseFolder.id });
    const tPad1 = createTrack({ name: 'P1 — Snare', kind: 'midi', parentId: pulseFolder.id });
    const tPad2 = createTrack({ name: 'P2 — Hats', kind: 'midi', parentId: pulseFolder.id });
    const tPad3 = createTrack({ name: 'P3 — Perc', kind: 'midi', parentId: pulseFolder.id });
    const tPad4 = createTrack({ name: 'P4 — Spark', kind: 'midi', parentId: pulseFolder.id });
    const tPad5 = createTrack({ name: 'P5 — Ghost', kind: 'midi', parentId: pulseFolder.id });
    for (const pad of [tPad0, tPad1, tPad2, tPad3, tPad4, tPad5]) {
        pad.devices = [];
    }

    // ── Fermenter presets ───────────────────────────────────────────────
    applyPreset(tSubDrone, 'fermenter-dark-drone');
    applyPreset(tDarkMist, 'fermenter-ambient-texture');
    applyPreset(tGrainHaze, 'fermenter-grain-cloud');
    applyPreset(tEtherealVeil, 'fermenter-ethereal-pad');
    applyPreset(tSweepHorizon, 'fermenter-sem-sweep');
    applyPreset(tWarmHalo, 'fermenter-warm-pad');
    applyPreset(tRisingMist, 'fermenter-mseg-pad');
    applyPreset(tWildDrift, 'fermenter-chaos-drift');

    tLevHigh.devices = [levainDevice({ masterGain: 0.72, vibratoDepth: 0.22, humanize: 0.55 })];
    tLevMid.devices = [levainDevice({ masterGain: 0.8, vibratoDepth: 0.1, humanize: 0.68 })];
    tLevLow.devices = [levainDevice({ masterGain: 0.85, vibratoDepth: 0.06, humanize: 0.58 })];
    tLevCall.devices = [levainDevice({ masterGain: 0.75, vibratoDepth: 0.18, humanize: 0.72 })];
    tLevAnswer.devices = [levainDevice({ masterGain: 0.7, vibratoDepth: 0.25, humanize: 0.64 })];

    tToasterRig.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Toaster',
            type: 'toaster',
            bypassed: false,
            parameterValues: {
                masterGain: 0.95,
                reverbMix: 0.38,
                delayMix: 0.22,
                swing: 0.12,
            },
        },
    ];
    tToasterRig.clips = [];

    const addDev = (t: { devices?: unknown[] }, type: string, name: string, params: Record<string, number>) => {
        t.devices = [
            ...(t.devices || []),
            {
                id: `dev-${crypto.randomUUID()}`,
                name,
                type,
                bypassed: false,
                parameterValues: params,
            },
        ];
    };

    // Master — wide, gentle glue (TD-era “space” mastering)
    addDev(masterTrack, 'builtin-eq', 'Master Tilt', {
        'eq-low-gain': 1.2,
        'eq-low-freq': 90,
        'eq-low-q': 0.75,
        'eq-mid-gain': -0.8,
        'eq-mid-freq': 450,
        'eq-mid-q': 1.1,
        'eq-high-gain': 1.8,
        'eq-high-freq': 11000,
        'eq-high-q': 0.65,
    });
    addDev(masterTrack, 'builtin-compressor', 'Soft Glue', {
        'comp-threshold': -16,
        'comp-ratio': 2.2,
        'comp-attack': 40,
        'comp-release': 280,
        'comp-knee': 18,
        'comp-makeup': 1.5,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Nebula Width', {
        'width-amount': 1.22,
        'width-mid': 0.08,
        'width-side': 1.35,
        'width-mono-bass': 160,
    });
    addDev(masterTrack, 'builtin-limiter', 'Ceiling', { 'lim-threshold': -0.8 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -15 });

    // Spatial / motion FX on selected Fermenter lines
    addDev(tGrainHaze, 'builtin-autopan', 'Grain Orbit', { 'autopan-rate': 0.08, 'autopan-depth': 0.62 });
    addDev(tGrainHaze, 'builtin-chorus', 'Grain Choir', {
        'chorus-rate': 0.12,
        'chorus-depth': 10,
        'chorus-feedback': 0.22,
        'chorus-mix': 0.38,
    });
    addDev(tEtherealVeil, 'builtin-reverb', 'Veil Hall', {
        'rev-size': 0.92,
        'rev-decay': 5.5,
        'rev-damping': 0.18,
        'rev-mix': 0.32,
    });
    addDev(tSweepHorizon, 'builtin-phaser', 'Sweep Phase', {
        'phaser-rate': 0.06,
        'phaser-depth': 0.75,
        'phaser-feedback': 0.48,
        'phaser-stages': 6,
    });
    addDev(tWarmHalo, 'builtin-delay', 'Halo Echo', {
        'delay-time': 444,
        'delay-feedback': 0.42,
        'delay-mix': 0.22,
    });
    addDev(tWildDrift, 'builtin-delay', 'Chaos Taps', {
        'delay-time': 333,
        'delay-feedback': 0.55,
        'delay-mix': 0.28,
    });
    addDev(tWildDrift, 'builtin-reverb', 'Chaos Space', {
        'rev-size': 0.88,
        'rev-decay': 4.2,
        'rev-damping': 0.25,
        'rev-mix': 0.26,
    });

    // Levain — space on the upper voices
    addDev(tLevHigh, 'builtin-reverb', 'High Plate', {
        'rev-size': 0.75,
        'rev-decay': 3.8,
        'rev-damping': 0.22,
        'rev-mix': 0.28,
    });
    addDev(tLevCall, 'builtin-delay', 'Call Slap', {
        'delay-time': 500,
        'delay-feedback': 0.35,
        'delay-mix': 0.2,
    });
    addDev(tLevAnswer, 'builtin-chorus', 'Answer Double', {
        'chorus-rate': 0.2,
        'chorus-depth': 8,
        'chorus-mix': 0.3,
    });

    // Mix staging
    tSubDrone.gain = 0.72;
    tDarkMist.gain = 0.55;
    tGrainHaze.gain = 0.48;
    tEtherealVeil.gain = 0.42;
    tSweepHorizon.gain = 0.52;
    tWarmHalo.gain = 0.5;
    tRisingMist.gain = 0.46;
    tWildDrift.gain = 0.44;
    tLevHigh.gain = 0.58;
    tLevMid.gain = 0.62;
    tLevLow.gain = 0.68;
    tLevCall.gain = 0.52;
    tLevAnswer.gain = 0.5;
    tToasterRig.gain = 0.85;
    tPad0.gain = 0.9;
    tPad1.gain = 0.75;
    tPad2.gain = 0.55;
    tPad3.gain = 0.62;
    tPad4.gain = 0.48;
    tPad5.gain = 0.4;

    tGrainHaze.pan = -32;
    tEtherealVeil.pan = 28;
    tLevHigh.pan = -22;
    tLevAnswer.pan = 24;
    tWildDrift.pan = 18;

    // ── MIDI clips (one full-length clip per track, notes in clip space) ───
    const clip = (trackId: string, name: string) => createMidiClip(trackId, name, 0, TB);

    const cSub = clip(tSubDrone.id, 'Sub');
    const cDark = clip(tDarkMist.id, 'Mist');
    const cGrain = clip(tGrainHaze.id, 'Grain');
    const cVeil = clip(tEtherealVeil.id, 'Veil');
    const cSweep = clip(tSweepHorizon.id, 'Sweep');
    const cWarm = clip(tWarmHalo.id, 'Halo');
    const cRise = clip(tRisingMist.id, 'Rise');
    const cWild = clip(tWildDrift.id, 'Wild');
    const cLH = clip(tLevHigh.id, 'High');
    const cLM = clip(tLevMid.id, 'Mid');
    const cLL = clip(tLevLow.id, 'Low');
    const cLC = clip(tLevCall.id, 'Call');
    const cLA = clip(tLevAnswer.id, 'Answer');
    const cK = clip(tPad0.id, 'Kick');
    const cS = clip(tPad1.id, 'Snare');
    const cH = clip(tPad2.id, 'Hat');
    const cP = clip(tPad3.id, 'Perc');
    const cSp = clip(tPad4.id, 'Spark');
    const cGh = clip(tPad5.id, 'Ghost');

    const subN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 24) {
        subN.push(note(A2, b, 28, 88));
    }

    const darkN: MidiNote[] = [];
    for (let b = 8; b < TB; b += 32) {
        darkN.push(note(E3, b, 30, 76));
        darkN.push(note(A3, b + 4, 26, 70));
    }

    const grainN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 12) {
        grainN.push(note(G4, b, 10, 62 + ((b / 12) % 5) * 4));
    }

    const veilN: MidiNote[] = [];
    for (let b = 4; b < TB; b += 20) {
        veilN.push(note(E5, b, 16, 58));
        veilN.push(note(C5, b + 10, 8, 52));
    }

    const sweepN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 8) {
        sweepN.push(note(A4, b, 6, 68));
        sweepN.push(note(D5, b + 4, 5, 64));
    }

    const warmN: MidiNote[] = [];
    for (let b = 16; b < TB; b += 48) {
        warmN.push(note(C4, b, 40, 72));
        warmN.push(note(E4, b + 16, 28, 66));
    }

    const riseN: MidiNote[] = [];
    for (let b = 24; b < TB; b += 18) {
        riseN.push(note(G4, b, 14, 60));
        riseN.push(note(B4, b + 9, 7, 55));
    }

    const wildN: MidiNote[] = [];
    const wildP = [D4, F4, A4, C5, E5, G4, A3, D5];
    for (let b = 0; b < TB; b += 5.5) {
        wildN.push(note(wildP[Math.floor(b) % wildP.length]!, b, 4, 56 + (Math.floor(b) % 8) * 3));
    }

    const highN: MidiNote[] = [];
    const highMelody = [E5, G5, A5, G5, E5, D5, C5, A4, E5, G5, E5, D5, C5, G4, A4, C5];
    let hi = 0;
    for (let b = 12; b < TB - 4; b += 3.5) {
        highN.push(note(highMelody[hi % highMelody.length]!, b, 2.8, 64 + (hi % 5) * 2));
        hi++;
    }

    const midN: MidiNote[] = [];
    const midMelody = [A4, C5, A4, G4, E4, D4, E4, G4, A4, C5, D5, C5, A4, G4, E4, A4];
    let mi = 0;
    for (let b = 6; b < TB - 6; b += 4) {
        midN.push(note(midMelody[mi % midMelody.length]!, b, 3.2, 70));
        mi++;
    }

    const lowN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 10) {
        lowN.push(note(A3, b, 8, 78));
        lowN.push(note(E3, b + 5, 4.5, 72));
    }

    const callN: MidiNote[] = [];
    for (let b = 20; b < TB; b += 28) {
        callN.push(note(D5, b, 6, 66));
        callN.push(note(A4, b + 8, 5, 60));
        callN.push(note(E5, b + 18, 4, 58));
    }

    const answerN: MidiNote[] = [];
    for (let b = 32; b < TB; b += 30) {
        answerN.push(note(C5, b, 5.5, 62));
        answerN.push(note(G4, b + 12, 4, 56));
        answerN.push(note(E4, b + 22, 6, 60));
    }

    const kickN: MidiNote[] = [];
    for (let b = 28; b < TB; b += 4) {
        if (b >= 108 && b < 132 && b % 8 !== 0) {
            continue;
        }
        const v = b < 48 ? 38 : b < 100 ? 58 : 72;
        kickN.push(note(60, b, 0.2, v));
    }

    const snareN: MidiNote[] = [];
    for (let b = 34; b < TB; b += 4) {
        if (b % 8 !== 2) {
            continue;
        }
        if (b >= 108 && b < 128) {
            continue;
        }
        snareN.push(note(60, b, 0.15, 52));
    }

    const hatN: MidiNote[] = [];
    for (let b = 30; b < TB; b += 1) {
        if (b < 40 && b % 2 !== 0) {
            continue;
        }
        if (b >= 108 && b < 124 && b % 4 !== 0) {
            continue;
        }
        const vel = b % 4 === 0 ? 44 : 32;
        hatN.push(note(60, b, 0.08, vel));
    }

    const percN: MidiNote[] = [];
    for (let b = 36; b < TB; b += 16) {
        percN.push(note(60, b, 0.12, 48));
    }

    const sparkN: MidiNote[] = [];
    for (let b = 44; b < TB; b += 24) {
        sparkN.push(note(60, b, 0.06, 42));
    }

    const ghostN: MidiNote[] = [];
    for (let b = 38; b < TB; b += 32) {
        ghostN.push(note(60, b + 2, 0.1, 28));
    }

    for (const t of [
        tSubDrone,
        tDarkMist,
        tGrainHaze,
        tEtherealVeil,
        tSweepHorizon,
        tWarmHalo,
        tRisingMist,
        tWildDrift,
        tLevHigh,
        tLevMid,
        tLevLow,
        tLevCall,
        tLevAnswer,
        tPad0,
        tPad1,
        tPad2,
        tPad3,
        tPad4,
        tPad5,
    ]) {
        t.clips = [];
    }

    tSubDrone.clips = [cSub];
    tDarkMist.clips = [cDark];
    tGrainHaze.clips = [cGrain];
    tEtherealVeil.clips = [cVeil];
    tSweepHorizon.clips = [cSweep];
    tWarmHalo.clips = [cWarm];
    tRisingMist.clips = [cRise];
    tWildDrift.clips = [cWild];
    tLevHigh.clips = [cLH];
    tLevMid.clips = [cLM];
    tLevLow.clips = [cLL];
    tLevCall.clips = [cLC];
    tLevAnswer.clips = [cLA];
    tPad0.clips = [cK];
    tPad1.clips = [cS];
    tPad2.clips = [cH];
    tPad3.clips = [cP];
    tPad4.clips = [cSp];
    tPad5.clips = [cGh];

    const tracks = [
        masterTrack,
        droneFolder,
        tSubDrone,
        tDarkMist,
        tGrainHaze,
        tEtherealVeil,
        motionFolder,
        tSweepHorizon,
        tWarmHalo,
        tRisingMist,
        tWildDrift,
        levainFolder,
        tLevHigh,
        tLevMid,
        tLevLow,
        tLevCall,
        tLevAnswer,
        pulseFolder,
        tToasterRig,
        tPad0,
        tPad1,
        tPad2,
        tPad3,
        tPad4,
        tPad5,
    ];

    trackStore.set({ tracks, selectedTrackId: tWarmHalo.id });

    midiStore.set({
        notesByClipId: {
            [cSub.id]: subN,
            [cDark.id]: darkN,
            [cGrain.id]: grainN,
            [cVeil.id]: veilN,
            [cSweep.id]: sweepN,
            [cWarm.id]: warmN,
            [cRise.id]: riseN,
            [cWild.id]: wildN,
            [cLH.id]: highN,
            [cLM.id]: midN,
            [cLL.id]: lowN,
            [cLC.id]: callN,
            [cLA.id]: answerN,
            [cK.id]: kickN,
            [cS.id]: snareN,
            [cH.id]: hatN,
            [cP.id]: percN,
            [cSp.id]: sparkN,
            [cGh.id]: ghostN,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    const mkLane = (trackId: string, param: string, label: string, min: number, max: number) =>
        createAutomationLane(trackId, param, label, min, max);

    const gSub = mkLane(tSubDrone.id, 'gain', 'Sub level', 0, 1);
    gSub.points = [
        { beat: 0, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 24, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 78, value: 1, curve: 'linear', tension: 0 },
        { beat: 120, value: 0.55, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const gGrain = mkLane(tGrainHaze.id, 'gain', 'Grain level', 0, 1);
    gGrain.points = [
        { beat: 0, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 40, value: 0.65, curve: 'smooth', tension: 0.4 },
        { beat: 90, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 132, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.12, curve: 'linear', tension: 0 },
    ];

    const panGrain = mkLane(tGrainHaze.id, 'pan', 'Grain pan', 0, 1);
    panGrain.points = [
        { beat: 0, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 52, value: 0.72, curve: 'smooth', tension: 0.5 },
        { beat: 104, value: 0.28, curve: 'smooth', tension: 0.45 },
        { beat: TB, value: 0.55, curve: 'linear', tension: 0 },
    ];

    const fcWild = mkLane(tWildDrift.id, 'filterCutoff', 'Wild cutoff', 300, 9000);
    fcWild.points = [
        { beat: 0, value: 1200, curve: 'linear', tension: 0 },
        { beat: 48, value: 4200, curve: 'exponential', tension: 0.3 },
        { beat: 96, value: 6800, curve: 'linear', tension: 0 },
        { beat: 132, value: 2400, curve: 'linear', tension: 0 },
        { beat: TB, value: 900, curve: 'linear', tension: 0 },
    ];

    const revWarm = mkLane(tWarmHalo.id, 'reverbMix', 'Halo verb', 0, 1);
    revWarm.points = [
        { beat: 16, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 72, value: 0.62, curve: 'smooth', tension: 0.35 },
        { beat: 120, value: 0.78, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.45, curve: 'linear', tension: 0 },
    ];

    const lfoSweep = mkLane(tSweepHorizon.id, 'lfoFilterAmount', 'Sweep LFO→filt', -1, 1);
    lfoSweep.points = [
        { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 60, value: 0.58, curve: 's-curve', tension: 0.5 },
        { beat: 110, value: 0.32, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.68, curve: 'linear', tension: 0 },
    ];

    const vibCall = mkLane(tLevCall.id, 'vibratoDepth', 'Call vibrato', 0, 1);
    vibCall.points = [
        { beat: 8, value: 0.08, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.28, curve: 'smooth', tension: 0.4 },
        { beat: 128, value: 0.42, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.15, curve: 'linear', tension: 0 },
    ];

    const panLevAns = mkLane(tLevAnswer.id, 'pan', 'Answer pan', 0, 1);
    panLevAns.points = [
        { beat: 0, value: 0.62, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.42, curve: 'smooth', tension: 0.4 },
        { beat: 100, value: 0.78, curve: 'smooth', tension: 0.35 },
        { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
    ];

    const gToaster = mkLane(tToasterRig.id, 'gain', 'Pulse bus', 0, 1);
    gToaster.points = [
        { beat: 0, value: 0, curve: 'linear', tension: 0 },
        { beat: 28, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 56, value: 0.72, curve: 'linear', tension: 0 },
        { beat: 108, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 132, value: 0.68, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.15, curve: 'linear', tension: 0 },
    ];

    const toastDelay = mkLane(tToasterRig.id, 'delayMix', 'Toaster delay', 0, 1);
    toastDelay.points = [
        { beat: 40, value: 0.12, curve: 'linear', tension: 0 },
        { beat: 88, value: 0.38, curve: 'smooth', tension: 0.3 },
        { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const toastRev = mkLane(tToasterRig.id, 'reverbMix', 'Toaster room', 0, 1);
    toastRev.points = [
        { beat: 0, value: 0.22, curve: 'linear', tension: 0 },
        { beat: 72, value: 0.48, curve: 'linear', tension: 0 },
        { beat: 120, value: 0.62, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.35, curve: 'linear', tension: 0 },
    ];

    const delayWildMix = mkLane(tWildDrift.id, 'delay-mix', 'Chaos delay wet', 0, 1);
    delayWildMix.points = [
        { beat: 24, value: 0.18, curve: 'linear', tension: 0 },
        { beat: 80, value: 0.42, curve: 'exponential', tension: 0.25 },
        { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
    ];

    const haloFb = mkLane(tWarmHalo.id, 'delay-feedback', 'Halo delay FB', 0, 0.92);
    haloFb.points = [
        { beat: 32, value: 0.28, curve: 'linear', tension: 0 },
        { beat: 96, value: 0.55, curve: 'smooth', tension: 0.4 },
        { beat: TB, value: 0.32, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            gSub,
            gGrain,
            panGrain,
            fcWild,
            revWarm,
            lfoSweep,
            vibCall,
            panLevAns,
            gToaster,
            toastDelay,
            toastRev,
            delayWildMix,
            haloFb,
        ],
    });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Horizon', color: 'oklch(0.38 0.08 260)' },
            { id: crypto.randomUUID(), beat: 24, name: 'Mist Rises', color: 'oklch(0.40 0.07 200)' },
            { id: crypto.randomUUID(), beat: 56, name: 'River', color: 'oklch(0.38 0.08 150)' },
            { id: crypto.randomUUID(), beat: 78, name: 'Pulse', color: 'oklch(0.39 0.09 45)' },
            { id: crypto.randomUUID(), beat: 108, name: 'Dissolve', color: 'oklch(0.40 0.07 300)' },
            { id: crypto.randomUUID(), beat: 132, name: 'Return', color: 'oklch(0.38 0.08 120)' },
            { id: crypto.randomUUID(), beat: 148, name: 'Fade', color: 'oklch(0.38 0.08 270)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 40, name: 'Intro Drift', color: 'oklch(0.38 0.08 260)' },
            { id: crypto.randomUUID(), startBeat: 40, endBeat: 78, name: 'Currents', color: 'oklch(0.40 0.07 200)' },
            { id: crypto.randomUUID(), startBeat: 78, endBeat: 108, name: 'Sequencer Shore', color: 'oklch(0.39 0.09 45)' },
            { id: crypto.randomUUID(), startBeat: 108, endBeat: 132, name: 'Thin Air', color: 'oklch(0.40 0.07 300)' },
            { id: crypto.randomUUID(), startBeat: 132, endBeat: TB, name: 'Afterglow', color: 'oklch(0.38 0.08 270)' },
        ],
    });

    syncArrangement(tracks);

    const { ensureTrackStrips } = await import('#/modules/Transport/useCases/ensureTrackStrips');
    ensureTrackStrips();

    const { waitForDevices } = await import('#/modules/AudioEngine/useCases/engineAccess');
    await waitForDevices();

    projectStore.set({
        name: 'Nebula Drift (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
    });
}
