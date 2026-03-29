/**
 * Demo 5 — Nebula Drift
 * ~5:00 @ 76 BPM | A minor / modal drift | Tangerine Dream–inspired atmosphere.
 *
 * Toaster (see createDrumTrackStack): parent track is a **folder** that **hosts** the Toaster
 * device; **16 child** MIDI tracks (one per pad) use `devices: []` and `outputId = parent.id`
 * so MIDI routes to the parent’s Toaster and audio sums on the parent strip. Folder strips are
 * skipped by ensureTrackStrips — we call addDeviceToStrip(parentId, …) before ensureTrackStrips
 * so the parent node exists when children route to it.
 *
 * Toaster pads: MIDI is split into **section clips** (Intro / Build / Peak / Break / Outro); empty
 * sections are omitted. Notes use **clip-relative** beats and GM pitches `36 + padIndex`.
 * Toaster folder + pad tracks use **muted oklch** strip/clip colors (not the kit’s bright PAD_COLORS).
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
import { DEFAULT_PAD_NAMES } from '#/modules/Toaster/models/ToasterKit';

const TB = 380;
const bpm = 76;

const A2 = 45;
const G2 = 43;
const D3 = 50;
const E3 = 52;
const A3 = 57;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const Fs4 = 66;
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const Fs5 = 78;
const G5 = 79;
const A5 = 81;

function levainDevice(overrides: Record<string, number> = {}) {
    return {
        id: `dev-${crypto.randomUUID()}`,
        name: 'Levain',
        type: 'levain' as const,
        bypassed: false,
        parameterValues: {
            masterGain: 1,
            humanize: 0.62,
            vibratoDepth: 0.14,
            legatoEnabled: 1,
            autoDivisi: 0,
            ensembleTiming: 1,
            ...overrides,
        },
    };
}

function addDev(t: { devices?: unknown[] }, type: string, name: string, params: Record<string, number>) {
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
}

/** Section boundaries (beats) for generative patterns */
const S = {
    intro: 0,
    build1: 72,
    peak: 148,
    breakdown: 232,
    final: 304,
    end: TB,
} as const;

/** Muted pad / clip tints for the Toaster (low chroma; avoids bright default PAD_COLORS). */
const NEBULA_TOASTER_PAD_COLORS: readonly string[] = Array.from({ length: 16 }, (_, i) => {
    const h = Math.round((i * 360) / 16);
    return `oklch(0.415 0.036 ${h})`;
});

/** Sub drone: starts at 0%, creeps up very slowly, still capped at 5% by the end. */
function subDroneGainKeyframes(tb: number) {
    return [
        { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
        { beat: 56, value: 0.003, curve: 'smooth' as const, tension: 0.52 },
        { beat: S.build1, value: 0.01, curve: 'smooth' as const, tension: 0.48 },
        { beat: S.peak, value: 0.024, curve: 'smooth' as const, tension: 0.42 },
        { beat: S.breakdown, value: 0.036, curve: 'smooth' as const, tension: 0.38 },
        { beat: S.final, value: 0.046, curve: 'smooth' as const, tension: 0.34 },
        { beat: tb, value: 0.05, curve: 'linear' as const, tension: 0 },
    ];
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

    const textureFolder = createTrack({ name: '✨ Pluck & Grain', kind: 'folder' });
    const tGrainStutter = createTrack({ name: 'Grain Stutter', kind: 'midi', parentId: textureFolder.id });
    const tMetalTick = createTrack({ name: 'Metal Tick', kind: 'midi', parentId: textureFolder.id });
    const tPluckA = createTrack({ name: 'Pluck Constellation', kind: 'midi', parentId: textureFolder.id });
    const tBellDust = createTrack({ name: 'Bell Dust', kind: 'midi', parentId: textureFolder.id });
    const tSeqRipple = createTrack({ name: 'Ciabatta Growl', kind: 'midi', parentId: textureFolder.id });

    const leadFolder = createTrack({ name: '🎹 Leads (Center)', kind: 'folder' });
    const tLeadMoog = createTrack({ name: 'Naan Sitar', kind: 'midi', parentId: leadFolder.id });
    const tLeadSync = createTrack({ name: 'Lead Sync', kind: 'midi', parentId: leadFolder.id });

    const bassFolder = createTrack({ name: '🎸 Groove Bass', kind: 'folder' });
    const tBassGroove = createTrack({ name: 'Rye Reese', kind: 'midi', parentId: bassFolder.id });

    const levainFolder = createTrack({ name: '🎻 Levain Lines', kind: 'folder' });
    const tLevHigh = createTrack({ name: 'Levain High', kind: 'midi', parentId: levainFolder.id });
    const tLevMid = createTrack({ name: 'Levain Mid', kind: 'midi', parentId: levainFolder.id });
    const tLevLow = createTrack({ name: 'Levain Low', kind: 'midi', parentId: levainFolder.id });
    const tLevCall = createTrack({ name: 'Levain Call', kind: 'midi', parentId: levainFolder.id });
    const tLevAnswer = createTrack({ name: 'Levain Answer', kind: 'midi', parentId: levainFolder.id });

    // ── Toaster: folder instrument + 16 pad children (same contract as createDrumTrackStack) ──
    const toasterFolder = createTrack({ name: '⚡ Toaster Kit', kind: 'folder' });
    toasterFolder.color = 'oklch(0.39 0.024 255)';
    toasterFolder.collapsed = false;
    const toasterDeviceId = `toaster-${crypto.randomUUID().slice(0, 8)}`;
    toasterFolder.devices = [
        {
            id: toasterDeviceId,
            name: 'Toaster',
            type: 'toaster',
            bypassed: false,
            parameterValues: {
                masterGain: 1.35,
                reverbMix: 0.22,
                delayMix: 0.08,
                swing: 0.08,
            },
        },
    ];

    const toasterPadTracks = Array.from({ length: 16 }, (_, i) => {
        const child = createTrack({
            name: DEFAULT_PAD_NAMES[i] ?? `Pad ${i + 1}`,
            kind: 'midi',
            parentId: toasterFolder.id,
        });
        child.devices = [];
        child.outputId = toasterFolder.id;
        child.color = NEBULA_TOASTER_PAD_COLORS[i] ?? child.color;
        return child;
    });

    // ── Fermenter / Levain instruments ─────────────────────────────────────
    applyPreset(tSubDrone, 'fermenter-dark-drone');
    applyPreset(tDarkMist, 'fermenter-ambient-texture');
    applyPreset(tGrainHaze, 'fermenter-grain-cloud');
    applyPreset(tEtherealVeil, 'fermenter-ethereal-pad');
    applyPreset(tSweepHorizon, 'fermenter-sem-sweep');
    applyPreset(tWarmHalo, 'fermenter-warm-pad');
    applyPreset(tRisingMist, 'fermenter-mseg-pad');
    applyPreset(tWildDrift, 'fermenter-chaos-drift');

    applyPreset(tGrainStutter, 'fermenter-grain-stutter');
    applyPreset(tMetalTick, 'fermenter-metallic-perc');
    applyPreset(tPluckA, 'fermenter-pluck-lead');
    applyPreset(tBellDust, 'fermenter-fm-bell');
    applyPreset(tSeqRipple, 'fermenter-fm-bass');

    applyPreset(tLeadMoog, 'fermenter-sitar');
    applyPreset(tLeadSync, 'fermenter-fm-organ');
    applyPreset(tBassGroove, 'fermenter-reese-bass');

    tLevHigh.devices = [levainDevice({ vibratoDepth: 0.24, humanize: 0.55 })];
    tLevMid.devices = [levainDevice({ vibratoDepth: 0.11, humanize: 0.68 })];
    tLevLow.devices = [levainDevice({ vibratoDepth: 0.07, humanize: 0.58 })];
    tLevCall.devices = [levainDevice({ vibratoDepth: 0.2, humanize: 0.72 })];
    tLevAnswer.devices = [levainDevice({ vibratoDepth: 0.26, humanize: 0.64 })];

    // Master chain
    addDev(masterTrack, 'builtin-eq', 'Master Tilt', {
        'eq-low-gain': 1.1,
        'eq-low-freq': 88,
        'eq-low-q': 0.72,
        'eq-mid-gain': -0.9,
        'eq-mid-freq': 440,
        'eq-mid-q': 1.05,
        'eq-high-gain': 1.6,
        'eq-high-freq': 10500,
        'eq-high-q': 0.62,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue', {
        'comp-threshold': -14,
        'comp-ratio': 2.4,
        'comp-attack': 35,
        'comp-release': 260,
        'comp-knee': 16,
        'comp-makeup': 1.8,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.2,
        'width-mid': 0.06,
        'width-side': 1.38,
        'width-mono-bass': 155,
    });
    addDev(masterTrack, 'builtin-limiter', 'Ceiling', { 'lim-threshold': -0.9 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -15 });

    // Drones + motion FX
    addDev(tGrainHaze, 'builtin-autopan', 'Grain Orbit', { 'autopan-rate': 0.06, 'autopan-depth': 0.75 });
    addDev(tGrainHaze, 'builtin-chorus', 'Grain Choir', {
        'chorus-rate': 0.14,
        'chorus-depth': 11,
        'chorus-feedback': 0.28,
        'chorus-mix': 0.42,
    });
    addDev(tGrainHaze, 'builtin-tremolo', 'Helicopter Chop', {
        'trem-rate': 6.5,
        'trem-depth': 0.5,
        'trem-shape': 1,
    });
    addDev(tEtherealVeil, 'builtin-tremolo', 'Veil Chop', {
        'trem-rate': 3.2,
        'trem-depth': 0.38,
        'trem-shape': 1,
    });
    addDev(tEtherealVeil, 'builtin-reverb', 'Veil Hall', {
        'rev-size': 0.94,
        'rev-decay': 5.8,
        'rev-damping': 0.16,
        'rev-mix': 0.34,
    });
    addDev(tSweepHorizon, 'builtin-phaser', 'Sweep Phase', {
        'phaser-rate': 0.05,
        'phaser-depth': 0.82,
        'phaser-feedback': 0.52,
        'phaser-stages': 6,
    });
    addDev(tWarmHalo, 'builtin-delay', 'Halo Echo', {
        'delay-time': 444,
        'delay-feedback': 0.48,
        'delay-mix': 0.26,
    });
    addDev(tWildDrift, 'builtin-delay', 'Chaos Taps', {
        'delay-time': 333,
        'delay-feedback': 0.58,
        'delay-mix': 0.32,
    });
    addDev(tWildDrift, 'builtin-reverb', 'Chaos Space', {
        'rev-size': 0.9,
        'rev-decay': 4.5,
        'rev-damping': 0.22,
        'rev-mix': 0.3,
    });
    addDev(tDarkMist, 'builtin-filter', 'Mist Shaper', {
        'filter-cutoff': 2400,
        'filter-resonance': 3.5,
        'filter-type': 0,
    });
    addDev(tDarkMist, 'builtin-tremolo', 'Mist Chop', {
        'trem-rate': 2.6,
        'trem-depth': 0.26,
        'trem-shape': 1,
    });
    addDev(tRisingMist, 'builtin-tremolo', 'Rise Pulse', {
        'trem-rate': 3.8,
        'trem-depth': 0.3,
        'trem-shape': 1,
    });
    addDev(tRisingMist, 'builtin-phaser', 'Rise Bloom', {
        'phaser-rate': 0.06,
        'phaser-depth': 0.72,
        'phaser-feedback': 0.5,
        'phaser-stages': 6,
    });

    // Textural lane FX (aggressive modulation targets)
    addDev(tGrainStutter, 'builtin-bitcrusher', 'Stutter Crush', {
        'crush-bits': 8,
        'crush-rate': 12,
        'crush-mix': 0.22,
    });
    addDev(tGrainStutter, 'builtin-autopan', 'Stutter Pan', { 'autopan-rate': 0.35, 'autopan-depth': 0.85 });
    addDev(tMetalTick, 'builtin-delay', 'Tick Delay', {
        'delay-time': 166,
        'delay-feedback': 0.62,
        'delay-mix': 0.38,
    });
    addDev(tPluckA, 'builtin-delay', 'Pluck Dots', {
        'delay-time': 375,
        'delay-feedback': 0.45,
        'delay-mix': 0.34,
    });
    addDev(tPluckA, 'builtin-reverb', 'Pluck Cloud', {
        'rev-size': 0.78,
        'rev-decay': 3.2,
        'rev-damping': 0.28,
        'rev-mix': 0.26,
    });
    addDev(tBellDust, 'builtin-chorus', 'Bell Shimmer', {
        'chorus-rate': 0.25,
        'chorus-depth': 9,
        'chorus-mix': 0.36,
    });
    addDev(tBellDust, 'builtin-phaser', 'Bell Phase', {
        'phaser-rate': 0.12,
        'phaser-depth': 0.7,
        'phaser-feedback': 0.45,
        'phaser-stages': 5,
    });
    addDev(tSeqRipple, 'builtin-filter', 'Growl Filter', {
        'filter-cutoff': 8000,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(tSeqRipple, 'builtin-distortion', 'Growl Drive', {
        'dist-drive': 2.5,
        'dist-tone': 2800,
        'dist-mix': 0.14,
    });

    // Leads — center-weighted space, not too wet (clarity in the mid)
    addDev(tLeadMoog, 'builtin-delay', 'Sitar Dotted', {
        'delay-time': 375,
        'delay-feedback': 0.32,
        'delay-mix': 0.18,
    });
    addDev(tLeadMoog, 'builtin-chorus', 'Sitar Width', {
        'chorus-rate': 0.45,
        'chorus-depth': 6,
        'chorus-mix': 0.22,
    });
    addDev(tLeadSync, 'builtin-reverb', 'Sync Tail', {
        'rev-size': 0.72,
        'rev-decay': 2.8,
        'rev-damping': 0.32,
        'rev-mix': 0.2,
    });
    addDev(tBassGroove, 'builtin-eq', 'Reese Pocket', {
        'eq-low-gain': 2.2,
        'eq-low-freq': 95,
        'eq-low-q': 0.9,
        'eq-mid-gain': -2.5,
        'eq-mid-freq': 280,
        'eq-mid-q': 1.4,
        'eq-high-gain': -1,
        'eq-high-freq': 3500,
        'eq-high-q': 0.8,
    });

    addDev(tLevHigh, 'builtin-reverb', 'High Plate', {
        'rev-size': 0.72,
        'rev-decay': 3.6,
        'rev-damping': 0.24,
        'rev-mix': 0.26,
    });
    addDev(tLevCall, 'builtin-delay', 'Call Slap', {
        'delay-time': 500,
        'delay-feedback': 0.4,
        'delay-mix': 0.22,
    });
    addDev(tLevAnswer, 'builtin-chorus', 'Answer Double', {
        'chorus-rate': 0.22,
        'chorus-depth': 9,
        'chorus-mix': 0.32,
    });

    // Initial levels & static pans (automation adds motion)
    const widePans = [-38, 34, -28, 30, -22, 26, -40, 36];
    let pi = 0;
    const nextPan = () => widePans[pi++ % widePans.length] ?? 0;

    tSubDrone.gain = 0;
    tDarkMist.gain = 0;
    tGrainHaze.gain = 1;
    tEtherealVeil.gain = 1;
    tSweepHorizon.gain = 0.85;
    tWarmHalo.gain = 1;
    tRisingMist.gain = 1;
    tWildDrift.gain = 1;
    tGrainStutter.gain = 1;
    tMetalTick.gain = 1;
    tPluckA.gain = 1;
    tBellDust.gain = 1;
    tSeqRipple.gain = 1;
    tLeadMoog.gain = 1;
    tLeadSync.gain = 1;
    tBassGroove.gain = 1;
    tLevHigh.gain = 0.1;
    tLevMid.gain = 0.1;
    tLevLow.gain = 0.1;
    tLevCall.gain = 0.1;
    tLevAnswer.gain = 0.1;
    toasterFolder.gain = 1.25;

    tSubDrone.pan = nextPan();
    tDarkMist.pan = nextPan();
    tGrainHaze.pan = nextPan();
    tEtherealVeil.pan = nextPan();
    void nextPan(); // keep widePans rotation aligned; Sweep uses automation extremes
    tSweepHorizon.pan = -50;
    tWarmHalo.pan = nextPan();
    tRisingMist.pan = nextPan();
    tWildDrift.pan = nextPan();
    tGrainStutter.pan = nextPan();
    tMetalTick.pan = nextPan();
    tPluckA.pan = nextPan();
    tBellDust.pan = nextPan();
    tSeqRipple.pan = nextPan();
    tLeadMoog.pan = -6;
    tLeadSync.pan = 8;
    tBassGroove.pan = 0;
    tLevHigh.pan = -20;
    tLevMid.pan = 6;
    tLevLow.pan = -12;
    tLevCall.pan = 18;
    tLevAnswer.pan = -16;

    for (const pad of toasterPadTracks) {
        pad.gain = 1;
    }

    const clip = (trackId: string, name: string) => createMidiClip(trackId, name, 0, TB);

    const cSub = clip(tSubDrone.id, 'Sub');
    const cDark = clip(tDarkMist.id, 'Mist');
    const cGrain = clip(tGrainHaze.id, 'Grain');
    const cVeil = clip(tEtherealVeil.id, 'Veil');
    const cSweep = clip(tSweepHorizon.id, 'Sweep');
    const cWarm = clip(tWarmHalo.id, 'Halo');
    const cRise = clip(tRisingMist.id, 'Rise');
    const cWild = clip(tWildDrift.id, 'Wild');
    const cGst = clip(tGrainStutter.id, 'Stutter');
    const cMet = clip(tMetalTick.id, 'Metal');
    const cPlk = clip(tPluckA.id, 'Pluck');
    const cBell = clip(tBellDust.id, 'Bell');
    const cSeq = clip(tSeqRipple.id, 'Growl');
    const cLMo = clip(tLeadMoog.id, 'Sitar');
    const cLSy = clip(tLeadSync.id, 'Sync');
    const cBss = clip(tBassGroove.id, 'Reese');
    const cLH = clip(tLevHigh.id, 'High');
    const cLM = clip(tLevMid.id, 'Mid');
    const cLL = clip(tLevLow.id, 'Low');
    const cLC = clip(tLevCall.id, 'Call');
    const cLA = clip(tLevAnswer.id, 'Answer');

    // ── MIDI content ──────────────────────────────────────────────────────
    const hum = (pitch: number, beat: number, duration: number, velocity: number, salt: number): MidiNote => {
        const tb = ((salt * 19) % 17) / 120 - 0.07;
        const td = ((salt * 11) % 7) / 180;
        const dv = ((salt * 23) % 11) - 5;
        const v = Math.max(1, Math.min(127, Math.round(velocity + dv)));
        return note(pitch, beat + tb, Math.max(0.08, duration + td), v);
    };

    const subN: MidiNote[] = [];
    for (let b = 0, s = 0; b < TB; b += 20, s++) {
        subN.push(hum(A2, b, 22, 84, s));
    }

    const darkN: MidiNote[] = [];
    for (let b = 6, s = 0; b < TB; b += 30, s++) {
        darkN.push(hum(E3, b, 26, 72, s));
        darkN.push(hum(A3, b + 6.2, 18, 66, s + 40));
    }

    const grainN: MidiNote[] = [];
    for (let b = 0, s = 0; b < TB; b += 14, s++) {
        grainN.push(hum(G4 + ((b % 21) / 7) * 2, b, 7, 54 + (s % 4) * 3, s));
    }

    const veilN: MidiNote[] = [];
    for (let b = 3, s = 0; b < TB; b += 22, s++) {
        veilN.push(hum(E5, b, 14, 52, s));
        if (s % 2 === 1) {
            veilN.push(hum(C5, b + 8.4, 8, 46, s + 11));
        }
    }

    const sweepN: MidiNote[] = [];
    for (let b = 1, s = 0; b < TB; b += 11, s++) {
        sweepN.push(hum(A4, b, 5, 62, s));
        if (s % 3 === 0) {
            sweepN.push(hum(D5, b + 4.1, 4, 58, s + 3));
        }
    }

    const warmN: MidiNote[] = [];
    for (let b = 14, s = 0; b < TB; b += 44, s++) {
        warmN.push(hum(C4, b, 36, 68, s));
        warmN.push(hum(E4, b + 16.3, 24, 62, s + 20));
    }

    const riseN: MidiNote[] = [];
    for (let b = 20, s = 0; b < TB; b += 18, s++) {
        riseN.push(hum(G4, b, 12, 56, s));
        if (s % 2 === 0) {
            riseN.push(hum(B4, b + 7.6, 6, 50, s + 7));
        }
    }

    const wildN: MidiNote[] = [];
    const wildP = [D4, F4, A4, C5, E5, G4, A3, D5, Fs4, G4];
    for (let b = 0, s = 0; b < TB; b += 7.5, s++) {
        if (b >= S.breakdown && b < S.final && s % 3 === 0) {
            continue;
        }
        wildN.push(hum(wildP[s % wildP.length]!, b, 3.6, 52 + (s % 5) * 2, s));
    }

    const stutterN: MidiNote[] = [];
    for (let b = 18, s = 0; b < TB; b += 4.25, s++) {
        if (b < S.build1 && s % 2 === 0) {
            continue;
        }
        if (b >= S.breakdown && b < S.final && s % 3 !== 0) {
            continue;
        }
        stutterN.push(hum(C5, b, 0.42, 40 + (s % 5) * 3, s));
    }

    const metalN: MidiNote[] = [];
    for (let b = 26, s = 0; b < TB; b += 13, s++) {
        metalN.push(hum(E5, b, 0.18, 46, s));
    }

    const pluckN: MidiNote[] = [];
    const pluckPat = [A4, C5, E5, G4, D5, A4, B4, E5, C5, G4, A4, D5];
    let px = 0;
    for (let b = 10; b < TB - 4; b += 4.5) {
        if (b >= S.breakdown && b < S.final && px % 3 !== 0) {
            px++;
            continue;
        }
        const vel = b >= S.peak && b < S.breakdown ? 74 : 58;
        pluckN.push(hum(pluckPat[px % pluckPat.length]!, b, 1.45, vel, px));
        px++;
    }

    const bellN: MidiNote[] = [];
    for (let b = 8, s = 0; b < TB; b += 26, s++) {
        bellN.push(hum(G5, b, 3.5, 42, s));
        if (s % 2 === 0) {
            bellN.push(hum(D5, b + 11.2, 2.8, 38, s + 50));
        }
    }

    const seqN: MidiNote[] = [];
    const seqPat = [E4, A4, C5, B4, G4, D5, E4, A3];
    let sx = 0;
    for (let b = 6; b < TB; b += 2.75) {
        const calm = b < S.build1 || (b >= S.breakdown && b < S.final);
        if (calm && sx % 2 === 0) {
            sx++;
            continue;
        }
        if (b >= S.peak && b < S.breakdown && sx % 5 === 3) {
            sx++;
            continue;
        }
        seqN.push(hum(seqPat[sx % seqPat.length]!, b, 0.52, 54, sx));
        sx++;
    }

    const leadMoogN: MidiNote[] = [];
    const moogPhrase = [A4, C5, E5, A5, G5, E5, D5, C5, B4, A4, E5, D5, C5, A4];
    let mx = 0;
    let bm = 44;
    while (bm < TB - 10) {
        if (!(bm >= S.breakdown && bm < S.final - 16)) {
            if (mx % 6 !== 4) {
                const vel = bm >= S.peak && bm < S.breakdown ? 74 : 66;
                leadMoogN.push(hum(moogPhrase[mx % moogPhrase.length]!, bm, 3.1, vel, mx + 100));
            }
        }
        mx++;
        const busy = bm >= S.peak && bm < S.breakdown;
        const step = busy ? 2.85 : bm >= S.build1 ? 3.9 : 4.6;
        bm += step;
    }

    const leadSyncN: MidiNote[] = [];
    const syncPhrase = [E5, A5, G5, Fs5, E5, D5, E5, A4, C5, E5, D5, B4];
    let sy = 0;
    for (let b = 92; b < TB - 8; b += 3.6) {
        if (b >= S.breakdown && b < S.final && sy % 2 === 0) {
            sy++;
            continue;
        }
        if (b >= S.peak && b < S.breakdown && sy % 6 === 2) {
            sy++;
            continue;
        }
        leadSyncN.push(hum(syncPhrase[sy % syncPhrase.length]!, b, 2.1, 64 + (sy % 4) * 2, sy + 200));
        sy++;
    }

    const bassN: MidiNote[] = [];
    let bi = 0;
    for (let b = S.build1; b < TB; b += 2) {
        const step = Math.floor(b / 2) % 8;
        const roots = [A2, A2, E3, A2, G2, A2, D3, E3];
        const root = roots[step] ?? A2;
        const dur = b >= S.peak && b < S.breakdown ? 1.75 : 1.55;
        if (bi % 9 === 7) {
            bi++;
            continue;
        }
        bassN.push(hum(root, b, dur, 72, bi + 300));
        bi++;
    }

    const highN: MidiNote[] = [];
    const highMelody = [E5, G5, A5, G5, E5, D5, C5, A4, E5, G5, E5, D5, C5, G4, A4, C5];
    let hi = 0;
    for (let b = 22; b < TB - 8; b += 5.8) {
        if (hi % 7 === 5) {
            hi++;
            continue;
        }
        highN.push(hum(highMelody[hi % highMelody.length]!, b, 3, 58 + (hi % 4) * 2, hi + 400));
        hi++;
    }

    const midN: MidiNote[] = [];
    const midMelody = [A4, C5, A4, G4, E4, D4, E4, G4, A4, C5, D5, C5, A4, G4, E4, A4];
    let mi = 0;
    for (let b = 28; b < TB - 10; b += 6.4) {
        if (mi % 8 === 6) {
            mi++;
            continue;
        }
        midN.push(hum(midMelody[mi % midMelody.length]!, b, 3.8, 64, mi + 500));
        mi++;
    }

    const lowN: MidiNote[] = [];
    for (let b = 4, s = 0; b < TB; b += 16, s++) {
        lowN.push(hum(A3, b, 9, 72, s + 600));
        if (s % 2 === 1) {
            lowN.push(hum(E3, b + 5.3, 5, 66, s + 601));
        }
    }

    const callN: MidiNote[] = [];
    for (let b = 32, s = 0; b < TB; b += 34, s++) {
        callN.push(hum(D5, b, 6, 60, s + 700));
        callN.push(hum(A4, b + 10.5, 5, 56, s + 701));
        if (s % 2 === 0) {
            callN.push(hum(E5, b + 19.2, 4, 52, s + 702));
        }
    }

    const answerN: MidiNote[] = [];
    for (let b = 48, s = 0; b < TB; b += 38, s++) {
        answerN.push(hum(C5, b, 5.5, 58, s + 800));
        answerN.push(hum(G4, b + 13.4, 4.5, 52, s + 801));
        if (s % 2 === 1) {
            answerN.push(hum(E4, b + 22.1, 6, 54, s + 802));
        }
    }

    // Toaster: one clip per arr.section per pad (skip empty) — notes are beat-relative to clip start
    const toasterSegLabels = ['Intro', 'Build', 'Peak', 'Break', 'Outro'] as const;
    const toasterSegRanges: readonly [number, number][] = [
        [0, S.build1],
        [S.build1, S.peak],
        [S.peak, S.breakdown],
        [S.breakdown, S.final],
        [S.final, TB],
    ];

    const toasterSegmentIndex = (absBeat: number): number => {
        if (absBeat < S.build1) {
            return 0;
        }
        if (absBeat < S.peak) {
            return 1;
        }
        if (absBeat < S.breakdown) {
            return 2;
        }
        if (absBeat < S.final) {
            return 3;
        }
        return 4;
    };

    const padSegNotes: MidiNote[][][] = Array.from({ length: 16 }, () =>
        toasterSegRanges.map(() => [] as MidiNote[]),
    );

    const pushToast = (pad: number, absBeat: number, vel: number, dur = 0.12) => {
        const si = toasterSegmentIndex(absBeat);
        const [segStart, segEnd] = toasterSegRanges[si]!;
        if (absBeat < segStart || absBeat >= segEnd) {
            return;
        }
        const rel = absBeat - segStart;
        padSegNotes[pad]![si]!.push(note(36 + pad, rel, dur, vel));
    };

    // Intro — sparse pulse before the kit locks (still GM-ish pitches per pad)
    for (let b = 6; b < S.build1; b += 10) {
        pushToast(5, b, 32 + (b % 5) * 2, 0.07);
    }
    for (let b = 10; b < S.build1; b += 4) {
        pushToast(2, b, 22 + (b % 4), 0.05);
    }
    for (let b = 18; b < S.build1; b += 16) {
        pushToast(0, b, 42, 0.16);
    }
    for (let b = 14; b < S.build1; b += 11) {
        pushToast(13, b, 28, 0.09);
    }
    for (let b = 22; b < S.build1; b += 18) {
        pushToast(12, b, 34, 0.08);
    }
    for (let b = 30; b < S.build1; b += 22) {
        pushToast(14, b, 30, 0.1);
    }
    for (let b = 38; b < S.build1; b += 26) {
        pushToast(6, b, 36, 0.14);
    }
    for (let b = 46; b < S.build1; b += 14) {
        pushToast(11, b, 32, 0.08);
    }
    pushToast(8, 58, 38, 0.14);
    pushToast(10, 64, 28, 0.32);
    pushToast(7, 68, 36, 0.12);

    for (let b: number = S.build1; b < TB; b += 4) {
        const intense = b >= S.peak && b < S.breakdown;
        const sparse = b >= S.breakdown && b < S.final;
        if (!sparse || b % 8 === 0) {
            pushToast(0, b, intense ? 86 : 58, 0.14);
        }
        if ((b + 2) % 8 === 0 && (!sparse || b % 16 === 2)) {
            pushToast(1, b + 0.25, intense ? 72 : 48, 0.1);
        }
        if (!sparse || b % 4 === 0) {
            const hVel = intense ? 42 : sparse ? 24 : 30;
            if (b % 2 === 0) {
                pushToast(2, b + 0.5, hVel, 0.055);
            }
            if (intense && b % 4 === 2) {
                pushToast(3, b + 1.5, 34, 0.12);
            }
            if (intense && b % 4 === 0) {
                pushToast(2, b + 1.25, hVel - 8, 0.048);
                pushToast(2, b + 2.5, hVel - 10, 0.048);
            }
        }
        if ((b % 16 === 8 || intense) && (!sparse || b % 16 === 0)) {
            pushToast(4, b + 0.08, intense ? 56 : 46, 0.06);
        }
        if (b % 8 === 4 || (intense && b % 12 === 0)) {
            pushToast(5, b + 0.15, intense ? 46 : 38, 0.065);
        }
        if (intense && b % 6 === 3) {
            pushToast(6, b + 0.3, 42, 0.11);
        } else if (!sparse && b % 20 === 10) {
            pushToast(6, b + 1, 34, 0.1);
        }
        if (intense && b % 8 === 4) {
            pushToast(7, b + 0.35, 48, 0.13);
        } else if (b % 24 === 16) {
            pushToast(7, b + 0.2, 38, 0.11);
        }
        if (b % 20 === 4 || (intense && b % 10 === 2)) {
            pushToast(8, b, 42, 0.18);
        }
        if (b === S.peak || b === S.breakdown || b === S.final) {
            pushToast(9, b + 0.02, 68, 0.42);
        }
        if (intense && b % 32 === 0) {
            pushToast(9, b + 0.08, 58, 0.38);
        }
        if (b % 32 === 12 || (intense && b % 16 === 8)) {
            pushToast(10, b + 0.05, 36, 0.32);
        }
        if (b % 16 === 6 || (intense && b % 8 === 2)) {
            pushToast(11, b + 0.18, intense ? 50 : 38, 0.085);
        }
        if ((intense && b % 8 === 6) || b % 20 === 14) {
            pushToast(12, b + 0.12, intense ? 40 : 28, 0.07);
        }
        if ((intense && b % 10 === 4) || (!sparse && !intense && b % 28 === 8)) {
            pushToast(13, b + 0.22, intense ? 44 : 30, 0.085);
        }
        if ((intense && b % 20 === 12) || (!sparse && b % 40 === 16)) {
            pushToast(14, b + 0.28, 32, 0.1);
        }
        if (intense && b % 24 === 8) {
            pushToast(15, b + 0.16, 30, 0.11);
        }
    }

    for (let pi = 0; pi < 16; pi++) {
        for (let s = 0; s < toasterSegRanges.length; s++) {
            padSegNotes[pi]![s]!.sort((a, b) => a.startBeat - b.startBeat);
        }
    }

    const toasterTrackClips: ReturnType<typeof createMidiClip>[][] = [];
    const toasterNotesByClipId: Record<string, MidiNote[]> = {};
    for (let padIdx = 0; padIdx < 16; padIdx++) {
        const t = toasterPadTracks[padIdx]!;
        const list: ReturnType<typeof createMidiClip>[] = [];
        for (let s = 0; s < toasterSegRanges.length; s++) {
            const arr = padSegNotes[padIdx]![s]!;
            if (arr.length === 0) {
                continue;
            }
            const [st, en] = toasterSegRanges[s]!;
            const padName = DEFAULT_PAD_NAMES[padIdx] ?? `Pad ${padIdx + 1}`;
            const c = createMidiClip(t.id, `${padName} · ${toasterSegLabels[s]}`, st, en, t.color);
            list.push(c);
            toasterNotesByClipId[c.id] = arr;
        }
        toasterTrackClips.push(list);
    }

    const allMidiTracks = [
        tSubDrone,
        tDarkMist,
        tGrainHaze,
        tEtherealVeil,
        tSweepHorizon,
        tWarmHalo,
        tRisingMist,
        tWildDrift,
        tGrainStutter,
        tMetalTick,
        tPluckA,
        tBellDust,
        tSeqRipple,
        tLeadMoog,
        tLeadSync,
        tBassGroove,
        tLevHigh,
        tLevMid,
        tLevLow,
        tLevCall,
        tLevAnswer,
        ...toasterPadTracks,
    ];
    for (const t of allMidiTracks) {
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
    tGrainStutter.clips = [cGst];
    tMetalTick.clips = [cMet];
    tPluckA.clips = [cPlk];
    tBellDust.clips = [cBell];
    tSeqRipple.clips = [cSeq];
    tLeadMoog.clips = [cLMo];
    tLeadSync.clips = [cLSy];
    tBassGroove.clips = [cBss];
    tLevHigh.clips = [cLH];
    tLevMid.clips = [cLM];
    tLevLow.clips = [cLL];
    tLevCall.clips = [cLC];
    tLevAnswer.clips = [cLA];
    toasterPadTracks.forEach((t, i) => {
        t.clips = toasterTrackClips[i] ?? [];
    });

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
        textureFolder,
        tGrainStutter,
        tMetalTick,
        tPluckA,
        tBellDust,
        tSeqRipple,
        leadFolder,
        tLeadMoog,
        tLeadSync,
        bassFolder,
        tBassGroove,
        levainFolder,
        tLevHigh,
        tLevMid,
        tLevLow,
        tLevCall,
        tLevAnswer,
        toasterFolder,
        ...toasterPadTracks,
    ];

    trackStore.set({ tracks, selectedTrackId: tLeadMoog.id });

    const notesByClipId: Record<string, MidiNote[]> = {
        [cSub.id]: subN,
        [cDark.id]: darkN,
        [cGrain.id]: grainN,
        [cVeil.id]: veilN,
        [cSweep.id]: sweepN,
        [cWarm.id]: warmN,
        [cRise.id]: riseN,
        [cWild.id]: wildN,
        [cGst.id]: stutterN,
        [cMet.id]: metalN,
        [cPlk.id]: pluckN,
        [cBell.id]: bellN,
        [cSeq.id]: seqN,
        [cLMo.id]: leadMoogN,
        [cLSy.id]: leadSyncN,
        [cBss.id]: bassN,
        [cLH.id]: highN,
        [cLM.id]: midN,
        [cLL.id]: lowN,
        [cLC.id]: callN,
        [cLA.id]: answerN,
    };
    Object.assign(notesByClipId, toasterNotesByClipId);

    midiStore.set({
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    const mkLane = (trackId: string, param: string, label: string, min: number, max: number) =>
        createAutomationLane(trackId, param, label, min, max);

    const dim = 0.07;
    const hero = 0.84;
    const levBed = 0.1;

    const padGainLanes = toasterPadTracks.map((pad, i) =>
        Object.assign(mkLane(pad.id, 'gain', `${pad.name} pad`, 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 70 + i, value: 0, curve: 'linear', tension: 0 },
                { beat: 98 + i, value: Math.min(1, 0.55 + (i % 5) * 0.06), curve: 'smooth', tension: 0.36 },
                { beat: S.peak, value: Math.min(1, 0.52 + (i % 4) * 0.07), curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: Math.min(1, 0.22 + (i % 3) * 0.05), curve: 'linear', tension: 0 },
                { beat: S.final, value: Math.min(1, 0.58 + (i % 4) * 0.05), curve: 'smooth', tension: 0.28 },
                { beat: TB, value: Math.min(1, 0.4 + (i % 5) * 0.05), curve: 'linear', tension: 0 },
            ],
        })
    );

    const lanes = [
        // Gain orchestration — slow reveals; few parts forward at once; sub from 0% → ≤5% over the full length
        Object.assign(mkLane(tSubDrone.id, 'gain', 'Sub (≤5%)', 0, 0.05), {
            points: subDroneGainKeyframes(TB),
        }),
        Object.assign(mkLane(tDarkMist.id, 'gain', 'Mist level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 10, value: 0.08, curve: 'smooth', tension: 0.35 },
                { beat: 44, value: 0.38, curve: 'smooth', tension: 0.32 },
                { beat: S.build1, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.4, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.46, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.32, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'gain', 'Grain level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 22, value: 0, curve: 'linear', tension: 0 },
                { beat: 52, value: 0.28, curve: 'smooth', tension: 0.38 },
                { beat: 110, value: 0.48, curve: 'smooth', tension: 0.3 },
                { beat: S.peak, value: 0.44, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.1, curve: 'smooth', tension: 0.38 },
                { beat: S.final, value: 0.38, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'gain', 'Veil level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 34, value: 0, curve: 'linear', tension: 0 },
                { beat: 62, value: 0.28, curve: 'smooth', tension: 0.36 },
                { beat: 128, value: 0.46, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.36, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.52, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.34, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.32, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'gain', 'Sweep level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 40, value: 0, curve: 'linear', tension: 0 },
                { beat: 68, value: 0.14, curve: 'smooth', tension: 0.35 },
                { beat: S.build1, value: 0.22, curve: 'linear', tension: 0 },
                { beat: 168, value: 0.28, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.11, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'gain', 'Halo level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 26, value: 0, curve: 'linear', tension: 0 },
                { beat: 54, value: 0.3, curve: 'smooth', tension: 0.36 },
                { beat: 118, value: 0.46, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.38, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.36, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.36, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'gain', 'Rising level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 48, value: 0, curve: 'linear', tension: 0 },
                { beat: 76, value: 0.24, curve: 'smooth', tension: 0.35 },
                { beat: 142, value: 0.38, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.36, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.48, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.34, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'gain', 'Wild level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 58, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0.2, curve: 'smooth', tension: 0.36 },
                { beat: S.peak, value: 0.42, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.12, curve: 'smooth', tension: 0.34 },
                { beat: S.final, value: 0.32, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'gain', 'Stutter level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 86, value: 0, curve: 'linear', tension: 0 },
                { beat: 112, value: 0.24, curve: 'smooth', tension: 0.38 },
                { beat: 188, value: 0.38, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.08, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.3, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tMetalTick.id, 'gain', 'Metal level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 98, value: 0, curve: 'linear', tension: 0 },
                { beat: 124, value: 0.26, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.4, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.14, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tPluckA.id, 'gain', 'Pluck level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 78, value: 0, curve: 'linear', tension: 0 },
                { beat: 104, value: 0.28, curve: 'smooth', tension: 0.36 },
                { beat: 176, value: 0.42, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.38, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.34, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.26, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBellDust.id, 'gain', 'Bell level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 92, value: 0, curve: 'linear', tension: 0 },
                { beat: 118, value: 0.2, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.32, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.1, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.26, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'gain', 'Growl level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 64, value: 0, curve: 'linear', tension: 0 },
                { beat: 90, value: 0.22, curve: 'smooth', tension: 0.38 },
                { beat: S.build1, value: 0.34, curve: 'linear', tension: 0 },
                { beat: 200, value: 0.42, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.12, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.36, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'gain', 'Sitar level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 50, value: 0, curve: 'linear', tension: 0 },
                { beat: 78, value: 0.18, curve: 'smooth', tension: 0.35 },
                { beat: 118, value: 0.1, curve: 'linear', tension: 0 },
                { beat: 168, value: 0.58, curve: 'smooth', tension: 0.32 },
                { beat: S.breakdown, value: 0.08, curve: 'smooth', tension: 0.28 },
                { beat: 248, value: 0.14, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.48, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 0.16, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadSync.id, 'gain', 'Sync lead', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0, curve: 'linear', tension: 0 },
                { beat: 108, value: 0.14, curve: 'smooth', tension: 0.35 },
                { beat: 152, value: 0.22, curve: 'linear', tension: 0 },
                { beat: 210, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.1, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.44, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBassGroove.id, 'gain', 'Reese level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: S.build1 + 6, value: 0, curve: 'linear', tension: 0 },
                { beat: S.build1 + 28, value: 0.38, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.58, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.16, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.5, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(toasterFolder.id, 'gain', 'Toaster bus', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 62, value: 0, curve: 'linear', tension: 0 },
                { beat: 92, value: 0.52, curve: 'smooth', tension: 0.36 },
                { beat: S.build1 + 32, value: 0.68, curve: 'smooth', tension: 0.32 },
                { beat: S.peak, value: 0.92, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.38, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.78, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.55, curve: 'linear', tension: 0 },
            ],
        }),
        // Levain — 10% bed at start; slow rise to tuck level; one hero at a time
        Object.assign(mkLane(tLevHigh.id, 'gain', 'Levain High spot', 0, 1), {
            points: [
                { beat: 0, value: levBed, curve: 'linear', tension: 0 },
                { beat: 40, value: dim, curve: 'smooth', tension: 0.48 },
                { beat: 44, value: hero, curve: 'smooth', tension: 0.32 },
                { beat: 114, value: hero, curve: 'linear', tension: 0 },
                { beat: 122, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevMid.id, 'gain', 'Levain Mid spot', 0, 1), {
            points: [
                { beat: 0, value: levBed, curve: 'linear', tension: 0 },
                { beat: 40, value: dim, curve: 'smooth', tension: 0.48 },
                { beat: 118, value: dim, curve: 'linear', tension: 0 },
                { beat: 122, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 190, value: hero, curve: 'linear', tension: 0 },
                { beat: 198, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevLow.id, 'gain', 'Levain Low spot', 0, 1), {
            points: [
                { beat: 0, value: levBed, curve: 'linear', tension: 0 },
                { beat: 40, value: dim, curve: 'smooth', tension: 0.48 },
                { beat: 194, value: dim, curve: 'linear', tension: 0 },
                { beat: 198, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 266, value: hero, curve: 'linear', tension: 0 },
                { beat: 274, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevCall.id, 'gain', 'Levain Call spot', 0, 1), {
            points: [
                { beat: 0, value: levBed, curve: 'linear', tension: 0 },
                { beat: 40, value: dim, curve: 'smooth', tension: 0.48 },
                { beat: 270, value: dim, curve: 'linear', tension: 0 },
                { beat: 274, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 342, value: hero, curve: 'linear', tension: 0 },
                { beat: 350, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevAnswer.id, 'gain', 'Levain Answer spot', 0, 1), {
            points: [
                { beat: 0, value: levBed, curve: 'linear', tension: 0 },
                { beat: 40, value: dim, curve: 'smooth', tension: 0.48 },
                { beat: 346, value: dim, curve: 'linear', tension: 0 },
                { beat: 350, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 374, value: hero, curve: 'linear', tension: 0 },
                { beat: TB, value: dim, curve: 'smooth', tension: 0.25 },
            ],
        }),
        ...padGainLanes,
        Object.assign(mkLane(tDarkMist.id, 'pan', 'Mist pan', 0, 1), {
            points: [
                { beat: 0, value: 0.42, curve: 'linear', tension: 0 },
                { beat: 96, value: 0.78, curve: 's-curve', tension: 0.55 },
                { beat: 200, value: 0.22, curve: 's-curve', tension: 0.5 },
                { beat: TB, value: 0.6, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'pan', 'Grain pan', 0, 1), {
            points: [
                { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
                { beat: 120, value: 0.85, curve: 'smooth', tension: 0.45 },
                { beat: 240, value: 0.18, curve: 'smooth', tension: 0.5 },
                { beat: TB, value: 0.72, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'pan', 'Veil pan', 0, 1), {
            points: [
                { beat: 16, value: 0.65, curve: 'linear', tension: 0 },
                { beat: 160, value: 0.25, curve: 's-curve', tension: 0.4 },
                { beat: 300, value: 0.88, curve: 's-curve', tension: 0.42 },
                { beat: TB, value: 0.48, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'filterCutoff', 'Wild cutoff', 250, 12000), {
            points: [
                { beat: 0, value: 900, curve: 'linear', tension: 0 },
                { beat: 100, value: 7200, curve: 'exponential', tension: 0.35 },
                { beat: S.peak, value: 10000, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 1800, curve: 'exponential', tension: 0.4 },
                { beat: S.final, value: 6500, curve: 'smooth', tension: 0.38 },
                { beat: TB, value: 700, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'delay-mix', 'Chaos delay', 0, 1), {
            points: [
                { beat: 40, value: 0.15, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.55, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 0.72, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'reverbMix', 'Halo verb', 0, 1), {
            points: [
                { beat: 20, value: 0.32, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 0.58, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.82, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.4, curve: 'smooth', tension: 0.4 },
                { beat: TB, value: 0.68, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'delay-feedback', 'Halo FB', 0, 0.92), {
            points: [
                { beat: 48, value: 0.22, curve: 'linear', tension: 0 },
                { beat: 180, value: 0.68, curve: 'exponential', tension: 0.25 },
                { beat: S.breakdown, value: 0.35, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.58, curve: 'smooth', tension: 0.35 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'lfoFilterAmount', 'Sweep LFO→F', -1, 1), {
            points: [
                { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 140, value: 0.75, curve: 's-curve', tension: 0.48 },
                { beat: S.breakdown, value: 0.15, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.82, curve: 'exponential', tension: 0.28 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'pan', 'Sweep pan', 0, 1), {
            points: [
                { beat: 0, value: 0.14, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 0.78, curve: 'smooth', tension: 0.4 },
                { beat: S.peak, value: 0.22, curve: 'smooth', tension: 0.38 },
                { beat: S.breakdown, value: 0.58, curve: 'smooth', tension: 0.36 },
                { beat: S.final, value: 0.26, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 0.62, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tDarkMist.id, 'filter-cutoff', 'Mist EQ', 200, 12000), {
            points: [
                { beat: 0, value: 1800, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 6200, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 900, curve: 'exponential', tension: 0.35 },
                { beat: TB, value: 4800, curve: 'linear', tension: 0 },
            ],
        }),
        // Texture / granular
        Object.assign(mkLane(tGrainStutter.id, 'grainDensity', 'Stutter density', 1, 100), {
            points: [
                { beat: 24, value: 35, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 88, curve: 'exponential', tension: 0.32 },
                { beat: S.breakdown, value: 42, curve: 'smooth', tension: 0.4 },
                { beat: TB, value: 72, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'crush-mix', 'Crush wet', 0, 1), {
            points: [
                { beat: 60, value: 0.12, curve: 'linear', tension: 0 },
                { beat: 200, value: 0.42, curve: 'exponential', tension: 0.35 },
                { beat: TB, value: 0.18, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'autopan-rate', 'Stutter pan rate', 0.1, 10), {
            points: [
                { beat: 0, value: 0.35, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 4.2, curve: 'smooth', tension: 0.4 },
                { beat: TB, value: 0.9, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tPluckA.id, 'delay-mix', 'Pluck delay', 0, 1), {
            points: [
                { beat: S.build1, value: 0.22, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.48, curve: 'exponential', tension: 0.28 },
                { beat: S.breakdown, value: 0.62, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBellDust.id, 'phaser-rate', 'Bell phase rate', 0.1, 10), {
            points: [
                { beat: 0, value: 0.15, curve: 'linear', tension: 0 },
                { beat: 160, value: 3.8, curve: 'exponential', tension: 0.38 },
                { beat: TB, value: 0.45, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'filter-cutoff', 'Growl cutoff', 100, 12000), {
            points: [
                { beat: 32, value: 3200, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 9800, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 1400, curve: 'exponential', tension: 0.35 },
                { beat: TB, value: 7200, curve: 'smooth', tension: 0.36 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'pan', 'Growl pan', 0, 1), {
            points: [
                { beat: 0, value: 0.72, curve: 'linear', tension: 0 },
                { beat: 220, value: 0.28, curve: 's-curve', tension: 0.5 },
                { beat: TB, value: 0.68, curve: 'linear', tension: 0 },
            ],
        }),
        // Extreme modulation — helicopter grain, chaos, Hopkins-style space
        Object.assign(mkLane(masterTrack.id, 'width-amount', 'Master width', 1, 1.52), {
            points: [
                { beat: 0, value: 1.04, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 1.12, curve: 'smooth', tension: 0.32 },
                { beat: S.peak - 8, value: 1.28, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 1.14, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 1.02, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 1.18, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 1.08, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'lfoRate', 'Grain LFO rate', 0, 24), {
            points: [
                { beat: 8, value: 0.35, curve: 'linear', tension: 0 },
                { beat: 56, value: 11, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: 112, value: 3.2, curve: 'step', tension: 0 },
                { beat: S.build1, value: 14, curve: 'exponential', tension: 0.42 },
                { beat: S.peak - 16, value: 6, curve: 'step', tension: 0 },
                { beat: S.peak, value: 17, curve: 'smooth', tension: 0.45 },
                { beat: S.breakdown, value: 1.2, curve: 'linear', tension: 0 },
                { beat: 288, value: 10, curve: 'stairs', tension: 0, stairSteps: 4 },
                { beat: TB, value: 4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'lfoPitchAmount', 'Grain LFO→pitch', -1, 1), {
            points: [
                { beat: 0, value: -0.08, curve: 'linear', tension: 0 },
                { beat: 88, value: 0.62, curve: 'smooth', tension: 0.4 },
                { beat: 160, value: -0.55, curve: 'step', tension: 0 },
                { beat: S.peak, value: 0.78, curve: 'exponential', tension: 0.35 },
                { beat: S.breakdown, value: -0.42, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.22, curve: 'smooth', tension: 0.3 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'grainSize', 'Grain size ms', 5, 500), {
            points: [
                { beat: 24, value: 95, curve: 'linear', tension: 0 },
                { beat: 140, value: 28, curve: 'exponential', tension: 0.3 },
                { beat: S.peak, value: 220, curve: 'smooth', tension: 0.38 },
                { beat: S.breakdown, value: 45, curve: 'step', tension: 0 },
                { beat: TB, value: 160, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'trem-rate', 'Heli chop Hz', 0.1, 20), {
            points: [
                { beat: 0, value: 4.2, curve: 'linear', tension: 0 },
                { beat: 72, value: 11, curve: 'stairs', tension: 0, stairSteps: 6 },
                { beat: S.build1, value: 3.5, curve: 'step', tension: 0 },
                { beat: S.peak, value: 17, curve: 'exponential', tension: 0.4 },
                { beat: S.breakdown, value: 6, curve: 'linear', tension: 0 },
                { beat: TB, value: 8.5, curve: 'smooth', tension: 0.32 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'trem-depth', 'Heli depth', 0, 1), {
            points: [
                { beat: 40, value: 0.28, curve: 'linear', tension: 0 },
                { beat: S.peak - 24, value: 0.78, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.35, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 0.22, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.38, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'chorus-rate', 'Grain chorus rate', 0.1, 10), {
            points: [
                { beat: S.intro, value: 0.35, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 6.5, curve: 'exponential', tension: 0.36 },
                { beat: S.breakdown, value: 1.1, curve: 'step', tension: 0 },
                { beat: TB, value: 3.8, curve: 'smooth', tension: 0.3 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'autopan-rate', 'Grain orbit rate', 0.05, 10), {
            points: [
                { beat: 0, value: 0.07, curve: 'linear', tension: 0 },
                { beat: 128, value: 2.4, curve: 'smooth', tension: 0.4 },
                { beat: S.peak, value: 0.12, curve: 'step', tension: 0 },
                { beat: 320, value: 5.5, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'chaosAmount', 'Chaos intensity', 0, 1), {
            points: [
                { beat: 16, value: 0.32, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 0.62, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.82, curve: 'exponential', tension: 0.32 },
                { beat: S.breakdown, value: 0.28, curve: 'step', tension: 0 },
                { beat: S.final, value: 0.68, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.48, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'lfoRate', 'Wild LFO', 0, 22), {
            points: [
                { beat: 0, value: 0.8, curve: 'linear', tension: 0 },
                { beat: 90, value: 12, curve: 'stairs', tension: 0, stairSteps: 4 },
                { beat: S.peak, value: 3.5, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 15, curve: 'smooth', tension: 0.42 },
                { beat: TB, value: 6, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'rev-decay', 'Chaos space decay', 0.1, 18), {
            points: [
                { beat: 48, value: 3.2, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 11, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 2.4, curve: 'step', tension: 0 },
                { beat: S.final, value: 14, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 5.5, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'delay-time', 'Chaos delay ms', 1, 2000), {
            points: [
                { beat: S.build1, value: 280, curve: 'linear', tension: 0 },
                { beat: S.peak - 8, value: 920, curve: 'exponential', tension: 0.38 },
                { beat: S.peak, value: 180, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 1100, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 420, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'lfoRate', 'Sweep LFO Hz', 0, 22), {
            points: [
                { beat: 20, value: 0.25, curve: 'linear', tension: 0 },
                { beat: 100, value: 9, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: S.peak, value: 0.6, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 14, curve: 'exponential', tension: 0.4 },
                { beat: TB, value: 4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'lfoPitchAmount', 'Sweep LFO→pitch', -1, 1), {
            points: [
                { beat: 0, value: 0.02, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 0.55, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: -0.48, curve: 'step', tension: 0 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'phaser-rate', 'Sweep phaser Hz', 0.1, 10), {
            points: [
                { beat: 32, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 7.2, curve: 'exponential', tension: 0.36 },
                { beat: S.breakdown, value: 0.35, curve: 'step', tension: 0 },
                { beat: 340, value: 5.5, curve: 'stairs', tension: 0, stairSteps: 6 },
                { beat: TB, value: 1.4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'phaser-feedback', 'Sweep phaser FB', 0, 0.95), {
            points: [
                { beat: 60, value: 0.42, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.82, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.28, curve: 'step', tension: 0 },
                { beat: TB, value: 0.62, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'delay-time', 'Halo echo ms', 1, 2000), {
            points: [
                { beat: S.intro, value: 380, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 720, curve: 'smooth', tension: 0.32 },
                { beat: S.peak, value: 140, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 980, curve: 'exponential', tension: 0.34 },
                { beat: S.final, value: 260, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: TB, value: 520, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'msegToFilter', 'Rise MSEG→F', -1, 1), {
            points: [
                { beat: 0, value: 0.45, curve: 'linear', tension: 0 },
                { beat: S.build1, value: -0.72, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.88, curve: 'exponential', tension: 0.35 },
                { beat: S.breakdown, value: -0.35, curve: 'step', tension: 0 },
                { beat: TB, value: 0.62, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'lfoRate', 'Rise LFO', 0, 18), {
            points: [
                { beat: 40, value: 0.15, curve: 'linear', tension: 0 },
                { beat: 160, value: 11, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: S.breakdown, value: 0.4, curve: 'step', tension: 0 },
                { beat: TB, value: 7, curve: 'smooth', tension: 0.33 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'trem-rate', 'Rise chop Hz', 0.1, 20), {
            points: [
                { beat: 0, value: 2.8, curve: 'linear', tension: 0 },
                { beat: S.peak - 20, value: 14, curve: 'exponential', tension: 0.4 },
                { beat: S.peak, value: 3.2, curve: 'step', tension: 0 },
                { beat: TB, value: 6, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'phaser-rate', 'Rise bloom Hz', 0.1, 10), {
            points: [
                { beat: 72, value: 0.08, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 5.5, curve: 'smooth', tension: 0.36 },
                { beat: S.breakdown, value: 0.15, curve: 'step', tension: 0 },
                { beat: TB, value: 2.8, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tDarkMist.id, 'lfoRate', 'Mist LFO', 0, 12), {
            points: [
                { beat: 0, value: 0.06, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 4.5, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.9, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 7.5, curve: 'exponential', tension: 0.38 },
                { beat: TB, value: 2.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tDarkMist.id, 'lfoFilterAmount', 'Mist LFO→F', -1, 1), {
            points: [
                { beat: 28, value: 0.18, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.72, curve: 'stairs', tension: 0, stairSteps: 4 },
                { beat: S.breakdown, value: 0.12, curve: 'step', tension: 0 },
                { beat: TB, value: 0.55, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tDarkMist.id, 'trem-rate', 'Mist chop Hz', 0.1, 20), {
            points: [
                { beat: 96, value: 1.8, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 9, curve: 'exponential', tension: 0.35 },
                { beat: S.breakdown, value: 2.2, curve: 'step', tension: 0 },
                { beat: TB, value: 4.5, curve: 'smooth', tension: 0.3 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'lfoRate', 'Veil LFO', 0, 10), {
            points: [
                { beat: 0, value: 0.18, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 5.5, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: S.breakdown, value: 0.25, curve: 'step', tension: 0 },
                { beat: TB, value: 3.2, curve: 'smooth', tension: 0.32 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'lfoFilterAmount', 'Veil LFO→F', -1, 1), {
            points: [
                { beat: 48, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.68, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: -0.42, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'rev-decay', 'Veil decay s', 0.1, 20), {
            points: [
                { beat: 24, value: 4.5, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 9.5, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 2.8, curve: 'step', tension: 0 },
                { beat: TB, value: 6.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'trem-rate', 'Veil chop Hz', 0.1, 20), {
            points: [
                { beat: 80, value: 2.4, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 11, curve: 'exponential', tension: 0.38 },
                { beat: S.breakdown, value: 3.5, curve: 'step', tension: 0 },
                { beat: TB, value: 5, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'trem-depth', 'Veil chop depth', 0, 1), {
            points: [
                { beat: 0, value: 0.22, curve: 'linear', tension: 0 },
                { beat: S.peak - 32, value: 0.72, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.28, curve: 'step', tension: 0 },
                { beat: TB, value: 0.48, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'seqRate', 'Growl seq Hz', 0.5, 20), {
            points: [
                { beat: 16, value: 5.5, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 14, curve: 'stairs', tension: 0, stairSteps: 6 },
                { beat: S.peak, value: 3.2, curve: 'step', tension: 0 },
                { beat: S.peak + 8, value: 17, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 6, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 11, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'audioModRate', 'Stutter AM rate', 0, 500), {
            points: [
                { beat: 32, value: 0, curve: 'linear', tension: 0 },
                { beat: S.build1, value: 180, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 420, curve: 'exponential', tension: 0.32 },
                { beat: S.breakdown, value: 60, curve: 'step', tension: 0 },
                { beat: TB, value: 260, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'audioModDepth', 'Stutter AM depth', 0, 1), {
            points: [
                { beat: 48, value: 0.08, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.62, curve: 'smooth', tension: 0.33 },
                { beat: TB, value: 0.18, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBellDust.id, 'chorus-rate', 'Bell shimmer rate', 0.1, 10), {
            points: [
                { beat: 0, value: 0.22, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 7.8, curve: 'exponential', tension: 0.36 },
                { beat: S.breakdown, value: 0.35, curve: 'step', tension: 0 },
                { beat: TB, value: 2.2, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tPluckA.id, 'delay-time', 'Pluck dots ms', 1, 2000), {
            points: [
                { beat: S.build1, value: 340, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 780, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 120, curve: 'step', tension: 0 },
                { beat: TB, value: 520, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'delay-time', 'Sitar dots ms', 1, 2000), {
            points: [
                { beat: 56, value: 320, curve: 'linear', tension: 0 },
                { beat: S.peak - 4, value: 900, curve: 'exponential', tension: 0.34 },
                { beat: S.peak, value: 200, curve: 'step', tension: 0 },
                { beat: S.breakdown, value: 640, curve: 'smooth', tension: 0.28 },
                { beat: TB, value: 400, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'chorus-mix', 'Sitar width wet', 0, 1), {
            points: [
                { beat: 0, value: 0.18, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.42, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.24, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'lfoRate', 'Sitar LFO', 0, 12), {
            points: [
                { beat: S.build1, value: 0.05, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 6.5, curve: 'stairs', tension: 0, stairSteps: 5 },
                { beat: S.breakdown, value: 0.2, curve: 'step', tension: 0 },
                { beat: TB, value: 3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadSync.id, 'rev-mix', 'Sync tail wet', 0, 1), {
            points: [
                { beat: S.build1, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.48, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 0.62, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadSync.id, 'lfoFilterAmount', 'Sync LFO→F', -1, 1), {
            points: [
                { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.75, curve: 'smooth', tension: 0.35 },
                { beat: S.breakdown, value: -0.35, curve: 'step', tension: 0 },
                { beat: TB, value: 0.45, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'pan', 'Sitar pan', 0, 1), {
            points: [
                { beat: S.build1, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.52, curve: 'smooth', tension: 0.2 },
                { beat: S.breakdown, value: 0.45, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBassGroove.id, 'pan', 'Reese pan', 0, 1), {
            points: [
                { beat: 100, value: 0.45, curve: 'linear', tension: 0 },
                { beat: 260, value: 0.58, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 0.48, curve: 'linear', tension: 0 },
            ],
        }),
        // Levain
        Object.assign(mkLane(tLevCall.id, 'vibratoDepth', 'Call vibrato', 0, 1), {
            points: [
                { beat: 12, value: 0.06, curve: 'linear', tension: 0 },
                { beat: 180, value: 0.38, curve: 'smooth', tension: 0.38 },
                { beat: TB, value: 0.12, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevAnswer.id, 'pan', 'Answer pan', 0, 1), {
            points: [
                { beat: 0, value: 0.68, curve: 'linear', tension: 0 },
                { beat: 150, value: 0.32, curve: 's-curve', tension: 0.45 },
                { beat: 280, value: 0.82, curve: 's-curve', tension: 0.42 },
                { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevMid.id, 'pan', 'Levain mid pan', 0, 1), {
            points: [
                { beat: 40, value: 0.52, curve: 'linear', tension: 0 },
                { beat: 200, value: 0.88, curve: 'smooth', tension: 0.4 },
                { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
            ],
        }),
        // Toaster (folder track — device params + bus level)
        Object.assign(mkLane(toasterFolder.id, 'delayMix', 'Toast delay', 0, 1), {
            points: [
                { beat: S.build1, value: 0.06, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.42, curve: 'exponential', tension: 0.35 },
                { beat: S.breakdown, value: 0.55, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.12, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(toasterFolder.id, 'reverbMix', 'Toast room', 0, 1), {
            points: [
                { beat: 0, value: 0.12, curve: 'linear', tension: 0 },
                { beat: 120, value: 0.38, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.52, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.68, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.22, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(toasterFolder.id, 'swing', 'Toast swing', 0, 1), {
            points: [
                { beat: S.build1, value: 0.04, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.22, curve: 'smooth', tension: 0.4 },
                { beat: S.breakdown, value: 0.45, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.1, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(toasterFolder.id, 'masterGain', 'Toast master', 0, 2), {
            points: [
                { beat: S.build1, value: 1.12, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 1.48, curve: 'exponential', tension: 0.25 },
                { beat: S.breakdown, value: 1.02, curve: 'linear', tension: 0 },
                { beat: S.final, value: 1.32, curve: 'smooth', tension: 0.28 },
                { beat: TB, value: 1.18, curve: 'linear', tension: 0 },
            ],
        }),
    ];

    automationStore.set({ lanes });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Horizon', color: 'oklch(0.38 0.08 260)' },
            { id: crypto.randomUUID(), beat: S.build1, name: 'Tide In', color: 'oklch(0.40 0.07 200)' },
            { id: crypto.randomUUID(), beat: S.peak - 16, name: 'Ridge', color: 'oklch(0.39 0.09 45)' },
            { id: crypto.randomUUID(), beat: S.peak, name: 'Summit', color: 'oklch(0.38 0.09 20)' },
            { id: crypto.randomUUID(), beat: S.breakdown, name: 'Fog', color: 'oklch(0.40 0.07 300)' },
            { id: crypto.randomUUID(), beat: S.final, name: 'Return', color: 'oklch(0.38 0.08 120)' },
            { id: crypto.randomUUID(), beat: TB - 12, name: 'Silence', color: 'oklch(0.38 0.08 270)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: S.intro, endBeat: S.build1, name: 'Intro Drift', color: 'oklch(0.38 0.08 260)' },
            { id: crypto.randomUUID(), startBeat: S.build1, endBeat: S.peak, name: 'Currents', color: 'oklch(0.40 0.07 200)' },
            { id: crypto.randomUUID(), startBeat: S.peak, endBeat: S.breakdown, name: 'Ridge Line', color: 'oklch(0.39 0.09 45)' },
            { id: crypto.randomUUID(), startBeat: S.breakdown, endBeat: S.final, name: 'Fog Bank', color: 'oklch(0.40 0.07 300)' },
            { id: crypto.randomUUID(), startBeat: S.final, endBeat: TB, name: 'Afterglow', color: 'oklch(0.38 0.08 270)' },
        ],
    });

    syncArrangement(tracks);

    const { addDeviceToStrip, updateDeviceParam } = await import('#/modules/AudioEngine/useCases/deviceControls');
    const {
        ensureTrackStrip,
        setTrackGain,
        setTrackPan,
        setTrackOutput,
        setTrackMute,
    } = await import('#/modules/AudioEngine/useCases/trackAudioControls');

    const toasterDev = toasterFolder.devices.find((d) => d.type === 'toaster');
    if (toasterDev) {
        addDeviceToStrip(toasterFolder.id, toasterDev.id, 'toaster');
        for (const [paramId, value] of Object.entries(toasterDev.parameterValues)) {
            if (typeof value === 'number') {
                updateDeviceParam(toasterFolder.id, toasterDev.id, paramId, value);
            }
        }
    }
    ensureTrackStrip(toasterFolder.id);
    setTrackOutput(toasterFolder.id, toasterFolder.outputId);
    setTrackGain(toasterFolder.id, toasterFolder.gain);
    setTrackPan(toasterFolder.id, toasterFolder.pan);
    setTrackMute(toasterFolder.id, toasterFolder.muted, toasterFolder.gain);

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
