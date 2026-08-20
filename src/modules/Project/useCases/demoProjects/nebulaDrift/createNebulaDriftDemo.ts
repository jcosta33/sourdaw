/**
 * Demo 5 — Nebula Drift
 * ~5:00 @ 76 BPM | A minor / modal drift | Tangerine Dream–inspired atmosphere.
 *
 * Toaster: parent track is a **folder** that **hosts** the Toaster
 * device; **16 child** MIDI tracks (one per pad) use `devices: []` and `outputId = parent.id`
 * so MIDI routes to the parent’s Toaster and audio sums on the parent strip. Folder strips are
 * skipped by ensureTrackStrips — projectTrackToLiveStrip publishes its validated
 * initialization snapshot before the parent is used as a child output.
 *
 * Toaster pads: MIDI is split into **section clips** (Intro / Build / Peak / Break / Outro); empty
 * sections are omitted. Notes use **clip-relative** beats and GM pitches `36 + padIndex`.
 * Toaster folder + pad tracks use **muted oklch** strip/clip colors (not the kit’s bright PAD_COLORS).
 */
import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { createTrack, projectTrackToLiveStrip } from '#/modules/Arrangement/useCases';
import { waitForDevices } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '#/modules/MIDI/stores';
import { addChordEvent, replaceChordTrackState } from '#/modules/MIDI/useCases';
import { addSidechainRoute } from '#/modules/Routing/useCases';
import { getDefaultPadNames } from '#/modules/Toaster/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import {
    addTempoChange,
    addTimeSignatureChange,
    defaultTransportState,
    ensureTrackStrips,
} from '#/modules/Transport/useCases';

import { createDefaultProductionBrief } from '../../../models/ProductionBrief';
import { projectStore } from '../../../stores/projectStore';
import { applyPreset } from '../demoUtils/applyPreset';
import { createMidiClip } from '../demoUtils/createMidiClip';
import { note } from '../demoUtils/note';
import { syncArrangement } from '../demoUtils/syncArrangement';

import type { MidiNote } from '../../../models/DemoProjectTypes';

const TB = 380;
const bpm = 76;

const G2 = 43;
const A2 = 45;
const D3 = 50;
const E3 = 52;
const F3 = 53;
const G3 = 55;
const A3 = 57;
const Bb3 = 58;
const B3 = 59;
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

function addDev(time: { devices?: unknown[] }, type: string, name: string, params: Record<string, number>) {
    time.devices = [
        ...(time.devices || []),
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
const NEBULA_TOASTER_PAD_COLORS: readonly string[] = Array.from({ length: 16 }, (_, index) => {
    const h = Math.round((index * 360) / 16);
    return `oklch(0.415 0.036 ${h})`;
});

/** Sub drone: starts at 0%, creeps up very slowly, capped at 5% by the end.
 *  Intentionally barely audible — felt more than heard as a foundation. */
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

    // ── Piano + granular texture layer ────────────────────────────────────
    const pianoFolder = createTrack({ name: '🎼 Piano & Haze', kind: 'folder' });
    const tGrandCrystal = createTrack({ name: 'Grand Crystal', kind: 'midi', parentId: pianoFolder.id });
    const tCrumbsHaze = createTrack({ name: 'Crumbs Haze', kind: 'midi', parentId: pianoFolder.id });

    // ── Send/return buses ─────────────────────────────────────────────────
    const tSpaceBus = createTrack({ name: 'Space Bus', kind: 'bus' });
    const tDelayBus = createTrack({ name: 'Delay Bus', kind: 'bus' });

    // ── Toaster: folder instrument + 16 pad children ─────────────────────────
    const toasterFolder = createTrack({ name: '⚡ Toaster Kit', kind: 'folder' });
    toasterFolder.color = 'oklch(0.39 0.024 255)';
    toasterFolder.collapsed = false;
    const toasterDeviceId = `toaster-${crypto.randomUUID()}`;
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

    const defaultPadNames = getDefaultPadNames();
    const toasterPadTracks = Array.from({ length: 16 }, (_, index) => {
        const child = createTrack({
            name: defaultPadNames[index] ?? `Pad ${index + 1}`,
            kind: 'midi',
            parentId: toasterFolder.id,
        });
        child.devices = [];
        child.outputId = toasterFolder.id;
        child.color = NEBULA_TOASTER_PAD_COLORS[index] ?? child.color;
        return child;
    });

    // ── Fermenter / Levain instruments ─────────────────────────────────────
    applyPreset(tSubDrone, 'fermenter-dark-drone');
    applyPreset(tDarkMist, 'fermenter-ambient-texture');
    applyPreset(tGrainHaze, 'fermenter-grain-cloud');
    // Grain Haze has 9 automation lanes (CPU-heavy), making it a natural freeze
    // candidate — but a demo cannot bake a real rendered buffer, and pointing
    // freezeState at a buffer id that was never written to audioBufferCache makes
    // every export of this demo emit a "missing audio buffer" warning and drop the
    // track to silence (renderOffline / offlineRender skip clip scheduling for a
    // frozen track, then read the absent buffer). Ship it unfrozen so the track
    // plays and exports from its live clips.
    tGrainHaze.frozen = false;
    tGrainHaze.freezeState = { status: 'unfrozen' };
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

    // Harmony auto-transpose on Levain High — follows the chord track
    tLevHigh.followChordTrack = true;

    // Soft keys for sparse dreamy chord roots.
    tGrandCrystal.devices = [
        {
            id: `keys-${crypto.randomUUID()}`,
            name: 'Soft Keys',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: { waveform: 1, attack: 0.04, release: 0.8, filterCutoff: 2600, gain: 0.32 },
        },
    ];

    // Crumbs — granular micro-stabs
    tCrumbsHaze.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Crumbs',
            type: 'builtin-crumbs',
            bypassed: false,
            parameterValues: { masterGain: 0.62, attack: 0.004, decay: 0.22, sustain: 0.3, release: 0.35 },
        },
    ];

    // Space Bus — dutch-oven (Proof Chamber) algorithmic reverb
    tSpaceBus.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Proof Chamber',
            type: 'dutch-oven',
            bypassed: false,
            parameterValues: {
                fdn_damping_version: 2,
                mix: 1, // fully wet — the bus IS the reverb return
                decay: 0.78,
                damping: 0.32,
                predelay: 28,
                size: 0.88,
                mod_rate: 0.35,
                mod_depth: 0.45,
                diffusion: 0.82,
                high_cut: 9500,
                low_cut: 120,
                width: 1.6,
                shimmer: 1,
                shimmer_amount: 0.18,
            },
        },
    ];

    // Delay Bus — faust tape delay at 3/4 of a beat (76 BPM → 0.789 s/beat × 0.75)
    const delayBeats = 0.75;
    const beatSeconds = 60 / bpm;
    tDelayBus.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Tape Delay',
            type: 'faust-tape-delay',
            bypassed: false,
            parameterValues: {
                delay: delayBeats * beatSeconds,
                feedback: 0.5,
                dry_wet: 1,
            },
        },
    ];

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
    // Sidechain compressor on the bass — pumped from Toaster Pad 0 (kick) for an organic peak pulse
    addDev(tBassGroove, 'builtin-sidechain-compressor', 'Kick Duck', {
        'sc-comp-threshold': -22,
        'sc-comp-ratio': 2,
        'sc-comp-attack': 6,
        'sc-comp-release': 180,
        'sc-comp-makeup': 1.5,
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
    function nextPan() {
        return widePans[pi++ % widePans.length] ?? 0;
    }

    tSubDrone.gain = 0;
    tDarkMist.gain = 0;
    tGrainHaze.gain = 1;
    tEtherealVeil.gain = 1;
    tSweepHorizon.gain = 0.85;
    tWarmHalo.gain = 0.2;
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
    nextPan(); // keep widePans rotation aligned; Sweep uses automation extremes
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

    // New track levels + pans
    tGrandCrystal.gain = 0.78;
    tGrandCrystal.pan = 4;
    tCrumbsHaze.gain = 0.55;
    tCrumbsHaze.pan = -8;
    tSpaceBus.gain = 0.9;
    tSpaceBus.pan = 0;
    tDelayBus.gain = 0.7;
    tDelayBus.pan = 0;

    // Send/return routing ─ reverb on pads + leads, tape delay on leads + pluck
    const send = (busId: string, level: number, preFader = false) => ({ busId, level, preFader });
    tWarmHalo.sends = [send(tSpaceBus.id, 0.32)];
    tEtherealVeil.sends = [send(tSpaceBus.id, 0.38)];
    tRisingMist.sends = [send(tSpaceBus.id, 0.3)];
    tDarkMist.sends = [send(tSpaceBus.id, 0.22)];
    tLeadMoog.sends = [send(tSpaceBus.id, 0.24), send(tDelayBus.id, 0.28)];
    tLeadSync.sends = [send(tSpaceBus.id, 0.2), send(tDelayBus.id, 0.22)];
    tLevCall.sends = [send(tSpaceBus.id, 0.26)];
    tLevAnswer.sends = [send(tSpaceBus.id, 0.24)];
    tPluckA.sends = [send(tDelayBus.id, 0.3)];
    tGrandCrystal.sends = [send(tSpaceBus.id, 0.42)];
    tCrumbsHaze.sends = [send(tSpaceBus.id, 0.36)];

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
    const cGrand = clip(tGrandCrystal.id, 'Crystal');
    const cCrumb = createMidiClip(tCrumbsHaze.id, 'Crumbs', S.peak, S.breakdown);
    const cBss = clip(tBassGroove.id, 'Reese');
    const cLH = clip(tLevHigh.id, 'High');
    const cLM = clip(tLevMid.id, 'Mid');
    const cLL = clip(tLevLow.id, 'Low');
    const cLC = clip(tLevCall.id, 'Call');
    const cLA = clip(tLevAnswer.id, 'Answer');

    // ── MIDI content ──────────────────────────────────────────────────────
    // Humanization: wider timing offsets (+-0.2 beats), more velocity variation (+-12)
    function hum(pitch: number, beat: number, duration: number, velocity: number, salt: number): MidiNote {
        const tb = ((salt * 19) % 37) / 95 - 0.2; // +-0.2 beats timing offset
        const td = ((salt * 11) % 13) / 60 - 0.1; // +-0.1 duration variance
        const dv = ((salt * 23) % 25) - 12; // +-12 velocity variance
        const value1 = Math.max(1, Math.min(127, Math.round(velocity + dv)));
        return note(pitch, Math.max(0, beat + tb), Math.max(0.08, duration + td), value1);
    }

    const subN: MidiNote[] = [];
    for (let b = 0, state = 0; b < TB; b += 20, state++) {
        subN.push(hum(A2, b, 22, 84, state));
    }

    // Dark Mist — evolving 5ths and 7ths, wider velocity range for more drama
    const darkN: MidiNote[] = [];
    const darkIntervals = [
        [E3, A3],
        [D3, A3],
        [E3, B4],
        [G2, D3],
        [A2, E3],
        [F3, C4],
    ];
    for (let b = 6, state = 0; b < TB; b += 28, state++) {
        const pair = darkIntervals[state % darkIntervals.length]!;
        const vel1 = b >= S.peak && b < S.breakdown ? 88 : 72;
        const vel2 = vel1 - 8;
        darkN.push(hum(pair[0]!, b, 24, vel1 + ((state * 5) % 7) - 3, state));
        darkN.push(hum(pair[1]!, b + 5.5, 18, vel2 + ((state * 3) % 5) - 2, state + 40));
    }

    // Grain Haze — slow granular texture drifting through a pitch field
    const grainN: MidiNote[] = [];
    const grainPitches = [G4, A4, D5, E4, C5, G4, B4, F4]; // wider pitch palette
    for (let b = 0, state = 0; b < TB; b += 12, state++) {
        const param = grainPitches[state % grainPitches.length]!;
        const vel = 48 + (state % 6) * 4 + (b >= S.peak ? 10 : 0);
        grainN.push(hum(param, b, 9, Math.min(90, vel), state));
    }

    // Ethereal Veil — slow drifting intervals, suspended feel
    const veilN: MidiNote[] = [];
    const veilPitches = [
        [E5, C5],
        [D5, A4],
        [G5, E5],
        [A5, E5],
        [Fs5, D5],
        [E5, B4],
    ];
    for (let b = 3, state = 0; b < TB; b += 20, state++) {
        const vp = veilPitches[state % veilPitches.length]!;
        veilN.push(hum(vp[0]!, b, 16, 52 + ((state * 3) % 9), state));
        if (state % 2 === 1 || b >= S.peak) {
            veilN.push(hum(vp[1]!, b + 7, 10, 44 + ((state * 5) % 7), state + 11));
        }
    }

    // Sweep Horizon — slow filter sweeps on sustained notes, modal ambiguity
    const sweepN: MidiNote[] = [];
    const sweepPitches = [A4, D5, E5, A4, C5, G4, B4, E5, Fs5, D5];
    for (let b = 1, state = 0; b < TB; b += 10, state++) {
        const param = sweepPitches[state % sweepPitches.length]!;
        const vel = 55 + ((state * 7) % 13) + (b >= S.peak && b < S.breakdown ? 15 : 0);
        sweepN.push(hum(param, b, 7, Math.min(95, vel), state));
        if (state % 3 === 0) {
            sweepN.push(hum(sweepPitches[(state + 3) % sweepPitches.length]!, b + 4.5, 4, vel - 6, state + 3));
        }
    }

    // Warm Halo — rich chord voicings: Am7, Cmaj9, Em7, Dm9, Fmaj7 with slow voice movement
    const warmN: MidiNote[] = [];
    const warmChords: number[][] = [
        [A3, C4, E4, G4], // Am7
        [C4, E4, G4, B4, D5], // Cmaj9
        [E3, G4, B4, D5], // Em7 (wide voicing)
        [D3, F4, A4, C5, E5], // Dm9
        [F3, A3, C4, E4], // Fmaj7
        [G2, B3, D4, F4, A4], // G7 (dominant passing)
        [A3, C4, E4, G4, B4], // Am9
        [Bb3, D4, F4, A4], // Bbmaj7 (Mixolydian color)
    ];
    let wi = 0;
    for (let b = 14; b < TB; b += 38, wi++) {
        const chord = warmChords[wi % warmChords.length]!;
        const baseVel = b >= S.peak && b < S.breakdown ? 82 : 62;
        for (let ci = 0; ci < chord.length; ci++) {
            // Stagger chord tones slightly for a more organic onset
            const offset = ci * 0.15;
            const vel = Math.max(40, baseVel - ci * 3 + ((wi * 7 + ci) % 5));
            warmN.push(hum(chord[ci]!, b + offset, 32, vel, wi * 10 + ci));
        }
    }

    // Rising Mist — slowly ascending gestures, sus chords resolving
    const riseN: MidiNote[] = [];
    const risePairs: [number, number][] = [
        [G4, B4],
        [A4, D5],
        [E4, A4],
        [D4, G4],
        [C4, E4],
        [F4, A4],
    ];
    for (let b = 20, state = 0; b < TB; b += 16, state++) {
        const rp = risePairs[state % risePairs.length]!;
        const vel = 50 + ((state * 5) % 11) + (b >= S.peak ? 14 : 0);
        riseN.push(hum(rp[0], b, 13, vel, state));
        if (state % 2 === 0 || b >= S.build1) {
            riseN.push(hum(rp[1], b + 6, 8, vel - 6, state + 7));
        }
    }

    // Wild Drift — chaotic, unpredictable texture. Wide intervals, chromatic neighbors.
    const wildN: MidiNote[] = [];
    const wildP = [D4, F4, A4, C5, E5, Fs4, Bb3, D5, G4, A3, E5, B4, Fs5];
    for (let b = 0, state = 0; b < TB; b += 7.5, state++) {
        // Sparse during breakdown
        if (b >= S.breakdown && b < S.final && state % 3 !== 0) {
            continue;
        }
        // Wider velocity range for chaos
        const vel = 42 + ((state * 17) % 20) + (b >= S.peak && b < S.breakdown ? 18 : 0);
        // Varying durations: some very short, some long and ringing
        const dur = (() => {
            if (state % 5 === 0) {
                return 6.0;
            }
            if (state % 5 === 3) {
                return 1.2;
            }
            return 3.6;
        })();
        wildN.push(hum(wildP[state % wildP.length]!, b, dur, Math.min(98, vel), state));
    }

    const stutterN: MidiNote[] = [];
    for (let b = 18, state = 0; b < TB; b += 4.25, state++) {
        if (b < S.build1 && state % 2 === 0) {
            continue;
        }
        if (b >= S.breakdown && b < S.final && state % 3 !== 0) {
            continue;
        }
        stutterN.push(hum(C5, b, 0.42, 40 + (state % 5) * 3, state));
    }

    const metalN: MidiNote[] = [];
    for (let b = 26, state = 0; b < TB; b += 13, state++) {
        metalN.push(hum(E5, b, 0.18, 46, state));
    }

    // Pluck Constellation — interlocking arpeggios at different rates (Eno-style)
    // Two interlocked patterns of different lengths create shifting phase relationships
    const pluckN: MidiNote[] = [];
    const pluckA = [A4, E5, C5, G5, D5, A5, E5, B4]; // ascending 8-note pattern
    const pluckB = [C5, A4, F4, D5, G4, E5]; // descending 6-note counter-pattern (different length = phase)
    let px = 0;
    // Pattern A: every 3.5 beats
    for (let b = 10; b < TB - 4; b += 3.5) {
        if (b >= S.breakdown && b < S.final && px % 4 !== 0) {
            px++;
            continue;
        }
        const baseVel = (() => {
            if (b >= S.peak && b < S.breakdown) {
                return 85;
            }
            if (b >= S.build1) {
                return 70;
            }
            return 55;
        })();
        const vel = baseVel + ((px * 11) % 9) - 4;
        const dur = px % 3 === 0 ? 2.2 : 1.1; // alternating long/short
        pluckN.push(hum(pluckA[px % pluckA.length]!, b, dur, Math.max(40, Math.min(100, vel)), px));
        px++;
    }
    // Pattern B: every 4.7 beats (different rate = shifting phase like Music for Airports)
    let pb = 0;
    for (let b = 18; b < TB - 4; b += 4.7) {
        if (b < S.build1 && pb % 3 !== 0) {
            pb++;
            continue;
        } // sparse in intro
        if (b >= S.breakdown && b < S.final && pb % 3 !== 0) {
            pb++;
            continue;
        }
        const vel = b >= S.peak && b < S.breakdown ? 78 : 58;
        pluckN.push(hum(pluckB[pb % pluckB.length]!, b, 1.8, vel + ((pb * 7) % 5) - 2, pb + 200));
        pb++;
    }

    // Bell Dust — FM bell tones at irregular intervals, like wind chimes
    const bellN: MidiNote[] = [];
    const bellPitches = [G5, D5, A5, E5, B4, Fs5, C5, G5];
    const bellSpacings = [26, 19, 23, 31, 17, 28]; // irregular spacing for organic feel
    let bellB = 8,
        bs = 0;
    while (bellB < TB) {
        const param = bellPitches[bs % bellPitches.length]!;
        const vel = 38 + ((bs * 11) % 15) + (bellB >= S.peak && bellB < S.breakdown ? 12 : 0);
        bellN.push(hum(param, bellB, 4, Math.min(85, vel), bs));
        if (bs % 3 === 0) {
            // Second bell a 5th below, offset
            bellN.push(hum(bellPitches[(bs + 4) % bellPitches.length]!, bellB + 8, 3, vel - 8, bs + 50));
        }
        bellB += bellSpacings[bs % bellSpacings.length]!;
        bs++;
    }

    // Berlin-school sequencer — hypnotic 16th-note pattern that evolves across sections.
    // Intro: 2-3 notes, sparse. Build: adds notes. Peak: full 8-note pattern. Break: stripped.
    const seqN: MidiNote[] = [];
    const seqIntro = [A3, E4]; // minimal pulse
    const seqBuild = [A3, C4, E4, A3, D4]; // expanding
    const seqPeak = [A3, C4, E4, G4, A4, G4, E4, D4]; // full Berlin pattern
    const seqBreak = [A3, E4, C4]; // stripped back
    const seqFinal = [A3, C4, E4, G4, A4, E4]; // rebuilding

    let sx = 0;
    // 16th notes at 76bpm = step every 0.25 beats (but use ~1 beat spacing for musicality)
    for (let b = 6; b < TB; b += 1.0) {
        const pat = (() => {
            if (b < S.build1) {
                return seqIntro;
            } else {
                if (b < S.peak) {
                    return seqBuild;
                } else {
                    if (b < S.breakdown) {
                        return seqPeak;
                    } else {
                        if (b < S.final) {
                            return seqBreak;
                        } else {
                            return seqFinal;
                        }
                    }
                }
            }
        })();

        // Intro: very sparse (every 4th step)
        if (b < S.build1 && sx % 4 !== 0) {
            sx++;
            continue;
        }
        // Build: every other step initially, filling in
        const buildProgress = (b - S.build1) / (S.peak - S.build1);
        if (b >= S.build1 && b < S.peak && sx % 3 === 2 && buildProgress < 0.5) {
            sx++;
            continue;
        }
        // Break: sparse
        if (b >= S.breakdown && b < S.final && sx % 3 !== 0) {
            sx++;
            continue;
        }

        const pi = sx % pat.length;
        // Accent pattern: emphasize downbeats
        const isAccent = pi === 0 || pi === 4;
        const baseVel = b >= S.peak && b < S.breakdown ? 80 : 60;
        const vel = isAccent ? baseVel + 15 : baseVel + ((sx * 13) % 9) - 4;

        seqN.push(hum(pat[pi]!, b, 0.7, Math.max(40, Math.min(100, vel)), sx));
        sx++;
    }

    // Naan Sitar — the track's main hook. A Dorian-flavored melody with yearning intervals.
    // Phrase A: ascending call with Dorian 6th (F#). Phrase B: answer with suspended resolution.
    // Phrase C (peak): ecstatic high register. Phrase D (outro): reflective descent.
    const leadMoogN: MidiNote[] = [];
    const phraseA = [A4, C5, D5, E5, Fs5, E5, D5, C5, A4, G4, A4]; // Dorian ascent
    const phraseB = [E5, D5, C5, A4, B4, C5, A4, G4, E4, D4, E4, A4]; // answer w/ suspension
    const phraseC = [A5, G5, E5, Fs5, A5, G5, D5, E5, Fs5, G5, A5, E5]; // ecstatic peak
    const phraseD = [E5, D5, C5, B4, A4, G4, Fs4, E4, D4, A4]; // reflective outro descent
    let mx = 0;
    let bm = 44;
    while (bm < TB - 10) {
        // Pick phrase based on section
        const phrase = (() => {
            if (bm < S.build1) {
                return phraseA;
            } else {
                if (bm < S.peak) {
                    return phraseB;
                } else {
                    if (bm < S.breakdown) {
                        return phraseC;
                    } else {
                        if (bm < S.final) {
                            return phraseD;
                        } else {
                            return phraseA;
                        }
                    }
                }
            }
        })();
        const inBreak = bm >= S.breakdown && bm < S.final - 16;
        if (!inBreak) {
            const pi = mx % phrase.length;
            // Velocity: wide dynamic range, louder at peak
            const baseVel = (() => {
                if (bm >= S.peak && bm < S.breakdown) {
                    return 88;
                }
                if (bm >= S.build1) {
                    return 76;
                }
                return 65;
            })();
            const velVar = ((mx * 17) % 11) - 5; // -5 to +5
            const vel = Math.max(40, Math.min(100, baseVel + velVar));
            // Duration varies: some long, some short for articulation
            const dur = (() => {
                if (pi % 3 === 0) {
                    return 4.2;
                }
                if (pi % 3 === 1) {
                    return 2.4;
                }
                return 3.5;
            })();
            // Rests: skip every 7th note for breathing room
            if (mx % 7 !== 6) {
                leadMoogN.push(hum(phrase[pi]!, bm, dur, vel, mx + 100));
            }
        }
        mx++;
        const busy = bm >= S.peak && bm < S.breakdown;
        const step = (() => {
            if (busy) {
                return 2.6;
            }
            if (bm >= S.build1) {
                return 3.5;
            }
            return 5.2;
        })();
        bm += step;
    }

    // Lead Sync — countermelody, responds to Sitar. Mixolydian flavor, more legato.
    const leadSyncN: MidiNote[] = [];
    const syncA = [E5, G5, Fs5, D5, E5, A4, B4, D5]; // Mixolydian response
    const syncB = [A5, G5, E5, D5, C5, D5, E5, G5, A5, Fs5]; // peak counterpoint
    let sy = 0;
    for (let b = 92; b < TB - 8; b += 4.2) {
        if (b >= S.breakdown && b < S.final && sy % 3 !== 0) {
            sy++;
            continue;
        }
        const phrase = b >= S.peak && b < S.breakdown ? syncB : syncA;
        const pi = sy % phrase.length;
        // Wider velocity range, accents on phrase starts
        const baseVel = b >= S.peak && b < S.breakdown ? 82 : 65;
        const vel = pi === 0 ? baseVel + 12 : baseVel + ((sy * 13) % 7) - 3;
        // Longer notes for legato feel
        const dur = (() => {
            if (pi % 4 === 0) {
                return 3.8;
            }
            if (pi % 4 === 2) {
                return 1.6;
            }
            return 2.8;
        })();
        leadSyncN.push(hum(phrase[pi]!, b, dur, Math.max(40, Math.min(100, vel)), sy + 200));
        sy++;
    }

    // Bass — Berlin-school root movement with syncopation and rests for breathing
    const bassN: MidiNote[] = [];
    const bassRoots = [A2, A2, E3, A2, G2, A2, D3, E3]; // harmonic foundation
    let bi = 0;
    for (let b = S.build1; b < TB; b += 2) {
        const step = Math.floor(b / 2) % 8;
        const root = bassRoots[step] ?? A2;
        // Vary duration more: longer sustained notes and short staccato
        const dur = (() => {
            if (bi % 4 === 0) {
                return 3.2;
            }
            if (bi % 4 === 2) {
                return 0.8;
            }
            return 1.6;
        })();
        // More varied velocity (40-95 range)
        const baseVel = b >= S.peak && b < S.breakdown ? 85 : 68;
        const vel = bi % 4 === 0 ? baseVel + 8 : baseVel - 10 + ((bi * 7) % 11);
        // More rests: skip ~20% of notes for groove
        if (bi % 5 === 4 || (b >= S.breakdown && b < S.final && bi % 3 !== 0)) {
            bi++;
            continue;
        }
        bassN.push(hum(root, b, dur, Math.max(40, Math.min(95, vel)), bi + 300));
        bi++;
    }

    // Levain High — lyrical melody with wider intervals, Dorian touches
    const highN: MidiNote[] = [];
    const highMelody = [E5, Fs5, G5, A5, G5, E5, D5, B4, A4, C5, E5, G5, Fs5, D5, E5, A5];
    let hi = 0;
    for (let b = 22; b < TB - 8; b += 5.8) {
        if (hi % 7 === 5) {
            hi++;
            continue;
        }
        const vel = 52 + (hi % 5) * 6 + (b >= S.peak && b < S.breakdown ? 16 : 0);
        const dur = hi % 3 === 0 ? 4.5 : 2.5;
        highN.push(hum(highMelody[hi % highMelody.length]!, b, dur, Math.min(98, vel), hi + 400));
        hi++;
    }

    // Levain Mid — counterpoint moving in contrary motion to High
    const midN: MidiNote[] = [];
    const midMelody = [A4, G4, E4, D4, C4, D4, E4, Fs4, G4, A4, B4, C5, D5, C5, A4, G4];
    let mi = 0;
    for (let b = 28; b < TB - 10; b += 6.4) {
        if (mi % 8 === 6) {
            mi++;
            continue;
        }
        const vel = 58 + ((mi * 7) % 9) + (b >= S.peak ? 10 : 0);
        midN.push(hum(midMelody[mi % midMelody.length]!, b, 4.2, Math.min(95, vel), mi + 500));
        mi++;
    }

    // Levain Low — slow pedal tones with 5th movement
    const lowN: MidiNote[] = [];
    const lowRoots = [A3, E3, D3, A3, G2, A3, F3, E3]; // harmonic rhythm
    for (let b = 4, state = 0; b < TB; b += 16, state++) {
        const root = lowRoots[state % lowRoots.length]!;
        lowN.push(hum(root, b, 12, 72 + ((state * 5) % 7) - 3, state + 600));
        if (state % 2 === 1) {
            lowN.push(hum(root + 7, b + 6, 6, 64, state + 601)); // 5th above
        }
    }

    // Levain Call — longer phrases with dramatic arc
    const callN: MidiNote[] = [];
    const callMelody = [D5, E5, Fs5, G5, A5, G5, E5, D5, C5, A4];
    for (let b = 32, state = 0; b < TB; b += 30, state++) {
        const len = Math.min(4, callMelody.length);
        for (let node = 0; node < len; node++) {
            const vel = 55 + node * 3 + (b >= S.peak ? 12 : 0);
            callN.push(
                hum(
                    callMelody[(state * 3 + node) % callMelody.length]!,
                    b + node * 4.5,
                    4,
                    vel,
                    state * 10 + node + 700
                )
            );
        }
    }

    // Levain Answer — response phrases in lower register
    const answerN: MidiNote[] = [];
    const answerMelody = [C5, B4, G4, A4, E4, D4, E4, G4, A4, C5];
    for (let b = 48, state = 0; b < TB; b += 34, state++) {
        const len = Math.min(3, answerMelody.length);
        for (let node = 0; node < len; node++) {
            const vel = 52 + node * 4 + (b >= S.peak ? 10 : 0);
            answerN.push(
                hum(
                    answerMelody[(state * 2 + node) % answerMelody.length]!,
                    b + node * 5.2,
                    5,
                    vel,
                    state * 10 + node + 800
                )
            );
        }
    }

    // Grand Crystal — sparse chord-root notes aligned with Warm Halo harmony.
    // 16 notes across 380 beats, dreamy barely-there velocity.
    // Warm Halo chord roots (cycle of 8, 38-beat spacing starting at beat 14):
    //   Am A3 | Cmaj C4 | Em E3 | Dm D3 | Fmaj F3 | G7 G2 | Am9 A3 | Bbmaj7 Bb3
    const crystalRoots = [A3, C4, E3, D3, F3, G2, A3, Bb3];
    const grandN: MidiNote[] = [];
    for (let k = 0, b = 18; k < 16 && b < TB - 8; k++, b += 24) {
        const rootIdx = k % crystalRoots.length;
        const root = crystalRoots[rootIdx]!;
        // Pair root + 5th above for a simple dyad — gentle piano voicing
        grandN.push(hum(root, b, 10, 40 + (k % 5) * 3, k + 900));
        grandN.push(hum(root + 7, b + 1.8, 8, 34 + (k % 4) * 3, k + 920));
    }

    // Crumbs Haze — short granular stabs in the Peak / Ridge section (148–232).
    const crumbN: MidiNote[] = [];
    const crumbPitches = [G3, C4, E4, G4, B3, D4, F4, A3, E4, C4, G4, D4];
    for (let k = 0; k < 12; k++) {
        const p = crumbPitches[k % crumbPitches.length]!;
        // Spread across 84-beat Peak span, clip-relative (clip starts at S.peak)
        const rel = (k + 0.5) * (84 / 12) + ((k * 7) % 3) * 0.4;
        crumbN.push(note(p, rel, 0.125, 48 + ((k * 11) % 9)));
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

    function toasterSegmentIndex(absBeat: number): number {
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
    }

    const padSegNotes: MidiNote[][][] = Array.from({ length: 16 }, () => toasterSegRanges.map(() => [] as MidiNote[]));

    function pushToast(pad: number, absBeat: number, vel: number, dur = 0.12) {
        const si = toasterSegmentIndex(absBeat);
        const [segStart, segEnd] = toasterSegRanges[si]!;
        if (absBeat < segStart || absBeat >= segEnd) {
            return;
        }
        const rel = absBeat - segStart;
        padSegNotes[pad]![si]!.push(note(36 + pad, rel, dur, vel));
    }

    // Intro — almost no drums, just occasional distant texture
    // Pad 5 = metallic shimmer, Pad 13 = subtle click
    for (let b = 24; b < S.build1; b += 18) {
        pushToast(5, b, 24 + (b % 5) * 2, 0.07); // very sparse metallic hits
    }
    for (let b = 45; b < S.build1; b += 24) {
        pushToast(13, b, 20, 0.05); // distant click
    }
    pushToast(10, 60, 22, 0.32); // single distant cymbal wash near end of intro

    // Build through Final — ambient/textural percussion, NOT standard dance patterns.
    // Think: occasional distant thuds, metallic resonances, subtle clicking textures.
    // Pad 0 = deep thud (not kick), Pad 5 = metallic shimmer, Pad 8 = sub rumble
    // Pad 10 = cymbal wash, Pad 11 = tiny click, Pad 13 = finger snap
    for (let b: number = S.build1; b < TB; b += 4) {
        const intense = b >= S.peak && b < S.breakdown;
        const sparse = b >= S.breakdown && b < S.final;

        // Deep thud — very sparse, like a distant heartbeat (not a kick pattern)
        if (b % 16 === 0 && (!sparse || b % 32 === 0)) {
            pushToast(0, b + 0.1, intense ? 65 : 45, 0.18);
        }

        // Metallic shimmer — irregular placements
        if (b % 12 === 4 || (intense && b % 8 === 6)) {
            pushToast(5, b + 0.15, intense ? 38 : 28, 0.065);
        }

        // Subtle clicking texture — very quiet, like distant rain
        if (intense && b % 4 === 2) {
            pushToast(11, b + 0.2, 30 + ((b >> 2) % 5) * 2, 0.04);
        } else if (!sparse && b % 8 === 2) {
            pushToast(11, b + 0.18, 22, 0.035);
        }

        // Cymbal wash — long, at section transitions and sparse moments
        if (b === S.peak || b === S.breakdown || b === S.final) {
            pushToast(10, b + 0.02, 55, 0.5); // section marker wash
        }
        if (intense && b % 32 === 16) {
            pushToast(10, b + 0.05, 35, 0.38); // periodic wash during peak
        }

        // Sub rumble — only at peak, very occasional
        if (intense && b % 24 === 0) {
            pushToast(8, b, 42, 0.22);
        }

        // Finger snap — scattered, human feel
        if (!sparse && b % 20 === 12) {
            pushToast(13, b + 0.25, intense ? 36 : 24, 0.06);
        }

        // Resonant ping — very rare, like sonar
        if (b % 40 === 20 && !sparse) {
            pushToast(6, b + 0.3, 32, 0.14);
        }

        // Ghost percussion — barely audible textural layer
        if (intense && b % 6 === 3) {
            pushToast(14, b + 0.28, 22, 0.05);
        }
    }

    // Peak drum groove — transform Toaster from texture to rhythm (beats 148–232).
    // Kick 4-on-floor, snare backbeat (2, 4), hat eighth shimmer.
    for (let b = S.peak; b < S.breakdown; b++) {
        pushToast(0, b, 92 + ((b & 3) === 0 ? 8 : 0), 0.18); // kick every beat, accent on downbeat
    }
    for (let b = S.peak + 1; b < S.breakdown; b += 2) {
        pushToast(1, b, 82 + ((b & 3) === 3 ? 6 : 0), 0.12); // snare on 2 and 4 (odd beats)
    }
    for (let b = S.peak; b < S.breakdown; b += 0.5) {
        const isOffbeat = (b * 2) % 2 === 1;
        pushToast(2, b, isOffbeat ? 46 : 58, 0.06); // eighth-note hat; offbeats quieter
    }

    for (let pi = 0; pi < 16; pi++) {
        for (let state = 0; state < toasterSegRanges.length; state++) {
            padSegNotes[pi]![state]!.sort((alpha, b) => alpha.startBeat - b.startBeat);
        }
    }

    const toasterTrackClips: ReturnType<typeof createMidiClip>[][] = [];
    const toasterNotesByClipId: Record<string, MidiNote[]> = {};
    for (let padIdx = 0; padIdx < 16; padIdx++) {
        const time = toasterPadTracks[padIdx]!;
        const list: ReturnType<typeof createMidiClip>[] = [];
        for (let state = 0; state < toasterSegRanges.length; state++) {
            const arr = padSegNotes[padIdx]![state]!;
            if (arr.length === 0) {
                continue;
            }
            const [st, en] = toasterSegRanges[state]!;
            const padName = defaultPadNames[padIdx] ?? `Pad ${padIdx + 1}`;
            const context = createMidiClip(time.id, `${padName} · ${toasterSegLabels[state]}`, st, en, time.color);
            list.push(context);
            toasterNotesByClipId[context.id] = arr;
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
        tGrandCrystal,
        tCrumbsHaze,
        ...toasterPadTracks,
    ];
    for (const time of allMidiTracks) {
        time.clips = [];
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
    tGrandCrystal.clips = [cGrand];
    tCrumbsHaze.clips = [cCrumb];
    for (const [i, t] of toasterPadTracks.entries()) {
        t.clips = toasterTrackClips[i] ?? [];
    }

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
        pianoFolder,
        tGrandCrystal,
        tCrumbsHaze,
        toasterFolder,
        ...toasterPadTracks,
        tSpaceBus,
        tDelayBus,
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
        [cGrand.id]: grandN,
        [cCrumb.id]: crumbN,
    };
    Object.assign(notesByClipId, toasterNotesByClipId);

    midiStore.set({
        probabilitySeed: midiStore.value?.probabilitySeed ?? LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    function mkLane(trackId: string, param: string, label: string, min: number, max: number) {
        return createAutomationLane(trackId, param, label, min, max);
    }

    const dim = 0.07;
    const hero = 0.84;
    // Intro bed. This was 0.1 — about −20 dB — and it was the *only* thing
    // sounding for the first ten bars, because every texture lane holds flat
    // zero before its staggered entry and Levain High does not reach `hero`
    // until beat 44. The piece read as silent until bar 11. The staircase is
    // the composition and is untouched; it just has to start from an audible
    // floor rather than from nothing.
    const levBed = 0.34;

    const padGainLanes = toasterPadTracks.map((pad, index) =>
        Object.assign(mkLane(pad.id, 'gain', `${pad.name} pad`, 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 70 + index, value: 0, curve: 'linear', tension: 0 },
                { beat: 98 + index, value: Math.min(1, 0.55 + (index % 5) * 0.06), curve: 'smooth', tension: 0.36 },
                { beat: S.peak, value: Math.min(1, 0.52 + (index % 4) * 0.07), curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: Math.min(1, 0.22 + (index % 3) * 0.05), curve: 'linear', tension: 0 },
                { beat: S.final, value: Math.min(1, 0.58 + (index % 4) * 0.05), curve: 'smooth', tension: 0.28 },
                { beat: TB, value: Math.min(1, 0.4 + (index % 5) * 0.05), curve: 'linear', tension: 0 },
            ],
        })
    );

    const lanes = [
        // Gain orchestration — slow reveals; few parts forward at once
        Object.assign(mkLane(tSubDrone.id, 'gain', 'Sub level', 0, 0.05), {
            points: subDroneGainKeyframes(TB),
        }),
        Object.assign(mkLane(tDarkMist.id, 'gain', 'Mist level', 0, 1), {
            points: [
                // Dark Mist is the first texture to enter and carries the intro
                // alone. It used to start at silence and reach only 0.12 by
                // beat 10, so the opening had nothing in it. It now enters
                // already sounding and rises into the same beat-44 value the
                // rest of the arc is built on.
                { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 10, value: 0.26, curve: 'smooth', tension: 0.35 },
                { beat: 44, value: 0.35, curve: 'smooth', tension: 0.32 },
                { beat: S.build1, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.62, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.5, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'gain', 'Grain level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 22, value: 0, curve: 'linear', tension: 0 },
                { beat: 52, value: 0.35, curve: 'smooth', tension: 0.38 },
                { beat: 110, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: S.peak, value: 0.65, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.15, curve: 'smooth', tension: 0.38 },
                { beat: S.final, value: 0.5, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.35, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'gain', 'Veil level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 34, value: 0, curve: 'linear', tension: 0 },
                { beat: 62, value: 0.35, curve: 'smooth', tension: 0.36 },
                { beat: 128, value: 0.55, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.65, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.7, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.5, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.45, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'gain', 'Sweep level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 40, value: 0, curve: 'linear', tension: 0 },
                { beat: 68, value: 0.3, curve: 'smooth', tension: 0.35 },
                { beat: S.build1, value: 0.45, curve: 'linear', tension: 0 },
                { beat: 168, value: 0.6, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'gain', 'Halo level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 26, value: 0, curve: 'linear', tension: 0 },
                { beat: 54, value: 0.4, curve: 'smooth', tension: 0.36 },
                { beat: 118, value: 0.6, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.72, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.65, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.55, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.45, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'gain', 'Rising level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 48, value: 0, curve: 'linear', tension: 0 },
                { beat: 76, value: 0.35, curve: 'smooth', tension: 0.35 },
                { beat: 142, value: 0.55, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.65, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.55, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.5, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'gain', 'Wild level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 58, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0.35, curve: 'smooth', tension: 0.36 },
                { beat: S.peak, value: 0.6, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.18, curve: 'smooth', tension: 0.34 },
                { beat: S.final, value: 0.5, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.35, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'gain', 'Stutter level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 86, value: 0, curve: 'linear', tension: 0 },
                { beat: 112, value: 0.35, curve: 'smooth', tension: 0.38 },
                { beat: 188, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.45, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tMetalTick.id, 'gain', 'Metal level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 98, value: 0, curve: 'linear', tension: 0 },
                { beat: 124, value: 0.4, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.55, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tPluckA.id, 'gain', 'Pluck level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 78, value: 0, curve: 'linear', tension: 0 },
                { beat: 104, value: 0.4, curve: 'smooth', tension: 0.36 },
                { beat: 176, value: 0.6, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.7, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.2, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.35, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBellDust.id, 'gain', 'Bell level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 92, value: 0, curve: 'linear', tension: 0 },
                { beat: 118, value: 0.35, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.5, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.15, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.4, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'gain', 'Growl level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 64, value: 0, curve: 'linear', tension: 0 },
                { beat: 90, value: 0.35, curve: 'smooth', tension: 0.38 },
                { beat: S.build1, value: 0.5, curve: 'linear', tension: 0 },
                { beat: 200, value: 0.65, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.18, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'gain', 'Sitar level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 50, value: 0, curve: 'linear', tension: 0 },
                { beat: 78, value: 0.35, curve: 'smooth', tension: 0.35 },
                { beat: 118, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 168, value: 0.75, curve: 'smooth', tension: 0.32 },
                { beat: S.breakdown, value: 0.1, curve: 'smooth', tension: 0.28 },
                { beat: 248, value: 0.25, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.7, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 0.25, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadSync.id, 'gain', 'Sync lead', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0, curve: 'linear', tension: 0 },
                { beat: 108, value: 0.3, curve: 'smooth', tension: 0.35 },
                { beat: 152, value: 0.45, curve: 'linear', tension: 0 },
                { beat: 210, value: 0.7, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.15, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.6, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBassGroove.id, 'gain', 'Reese level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: S.build1 + 6, value: 0, curve: 'linear', tension: 0 },
                { beat: S.build1 + 28, value: 0.4, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.6, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.15, curve: 'smooth', tension: 0.32 },
                { beat: S.final, value: 0.5, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.25, curve: 'linear', tension: 0 },
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
            {
                id: crypto.randomUUID(),
                startBeat: S.intro,
                endBeat: S.build1,
                name: 'Intro Drift',
                color: 'oklch(0.38 0.08 260)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.build1,
                endBeat: S.peak,
                name: 'Currents',
                color: 'oklch(0.40 0.07 200)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.peak,
                endBeat: S.breakdown,
                name: 'Ridge Line',
                color: 'oklch(0.39 0.09 45)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.breakdown,
                endBeat: S.final,
                name: 'Fog Bank',
                color: 'oklch(0.40 0.07 300)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.final,
                endBeat: TB,
                name: 'Afterglow',
                color: 'oklch(0.38 0.08 270)',
            },
        ],
    });

    // ── Tempo drift (76 → 78 at Peak → back to 76 at Fog) ─────────────────
    tempoMapStore.set({ changes: [] });
    addTempoChange(0, bpm, 'instant');
    addTempoChange(S.peak, 78, 'linear');
    addTempoChange(S.breakdown, bpm, 'linear');

    // ── Time signature: brief 6/8 excursion at Peak, back to 4/4 ──────────
    timeSignatureMapStore.set({ changes: [] });
    addTimeSignatureChange(0, 4, 4);
    addTimeSignatureChange(S.peak, 6, 8);
    addTimeSignatureChange(S.peak + 12, 4, 4);

    // ── Chord track — 8-chord progression matching Warm Halo voicings ────
    //   Am9 | Cmaj9 | Em7 | Dm9 | Fmaj7 | G7 | Am9 | Bbmaj7
    //   (Cmaj9 and Am9 use available CHORD_TYPES keys; 'maj7' + 'min9' are the
    //   closest approximations in the type set.)
    replaceChordTrackState({ enabled: true, events: [] });
    type ChordQual = 'min9' | 'maj7' | 'min7' | '7';
    const chordProgression: Array<[number, ChordQual]> = [
        [9, 'min9'], // Am9
        [0, 'maj7'], // Cmaj9 approx (maj9 not in CHORD_TYPES)
        [4, 'min7'], // Em7
        [2, 'min9'], // Dm9
        [5, 'maj7'], // Fmaj7
        [7, '7'], // G7
        [9, 'min9'], // Am9
        [10, 'maj7'], // Bbmaj7
    ];
    const chordDur = 32;
    for (let i = 0; i * chordDur < TB; i++) {
        const [root, quality] = chordProgression[i % chordProgression.length]!;
        addChordEvent(i * chordDur, root, quality, chordDur);
    }

    // ── Sidechain route: Toaster Pad 0 (kick) → Rye Reese's sidechain comp ─
    const reeseSidechainDev = tBassGroove.devices.find((d) => d.type === 'builtin-sidechain-compressor');
    if (reeseSidechainDev) {
        addSidechainRoute(toasterPadTracks[0]!.id, tBassGroove.id, reeseSidechainDev.id, 'sc-comp-threshold');
    }

    syncArrangement(tracks);

    projectTrackToLiveStrip({ trackId: toasterFolder.id });

    const createdAt = Date.now();
    projectStore.set({
        name: 'Nebula Drift (Demo)',
        createdAt,
        updatedAt: createdAt,
        dirty: false,
        loading: true,
        // Ready is NOT latched here — same seam as initProject. This demo runs as
        // an app-action template inside executeAppAction; latching `initialized`
        // before its track/selection writes settle lets the late-landing writes
        // clobber a user's early track click (CC-10). createFromTemplate publishes
        // the ready latch after the action completes.
        initialized: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
        },
        productionBrief: createDefaultProductionBrief(createdAt),
    });

    ensureTrackStrips();
    await waitForDevices();
}
