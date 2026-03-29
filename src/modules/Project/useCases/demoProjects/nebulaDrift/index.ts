/**
 * Demo 5 — Nebula Drift
 * ~5:00 @ 76 BPM | A minor / modal drift | Tangerine Dream–inspired atmosphere.
 *
 * Toaster (see createDrumTrackStack): parent track is a **folder** that **hosts** the Toaster
 * device; **16 child** MIDI tracks (one per pad) use `devices: []` and `outputId = parent.id`
 * so MIDI routes to the parent’s Toaster and audio sums on the parent strip. Folder strips are
 * skipped by ensureTrackStrips — we call addDeviceToStrip(parentId, …) before ensureTrackStrips
 * so the parent node exists when children route to it.
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
import { DEFAULT_PAD_NAMES, PAD_COLORS } from '#/modules/Toaster/models/ToasterKit';

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

/** Sub drone: never above 5% — slow oscillation 0 ↔ 0.05 */
function subDroneGainKeyframes(tb: number) {
    const pts: Array<{ beat: number; value: number; curve: 'smooth' | 'linear'; tension: number }> = [];
    const step = 24;
    for (let b = 0; b <= tb; b += step) {
        const loud = Math.floor(b / step) % 2 === 1;
        pts.push({ beat: b, value: loud ? 0.05 : 0, curve: 'smooth', tension: 0.42 });
    }
    if (pts[pts.length - 1]!.beat < tb) {
        const last = pts[pts.length - 1]!.value;
        pts.push({ beat: tb, value: last, curve: 'linear', tension: 0 });
    }
    return pts;
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
    const tSeqRipple = createTrack({ name: 'Seq Ripple', kind: 'midi', parentId: textureFolder.id });

    const leadFolder = createTrack({ name: '🎹 Leads (Center)', kind: 'folder' });
    const tLeadMoog = createTrack({ name: 'Lead Moog', kind: 'midi', parentId: leadFolder.id });
    const tLeadSync = createTrack({ name: 'Lead Sync', kind: 'midi', parentId: leadFolder.id });

    const bassFolder = createTrack({ name: '🎸 Groove Bass', kind: 'folder' });
    const tBassGroove = createTrack({ name: 'Moog Bass', kind: 'midi', parentId: bassFolder.id });

    const levainFolder = createTrack({ name: '🎻 Levain Lines', kind: 'folder' });
    const tLevHigh = createTrack({ name: 'Levain High', kind: 'midi', parentId: levainFolder.id });
    const tLevMid = createTrack({ name: 'Levain Mid', kind: 'midi', parentId: levainFolder.id });
    const tLevLow = createTrack({ name: 'Levain Low', kind: 'midi', parentId: levainFolder.id });
    const tLevCall = createTrack({ name: 'Levain Call', kind: 'midi', parentId: levainFolder.id });
    const tLevAnswer = createTrack({ name: 'Levain Answer', kind: 'midi', parentId: levainFolder.id });

    // ── Toaster: folder instrument + 16 pad children (same contract as createDrumTrackStack) ──
    const toasterFolder = createTrack({ name: '⚡ Toaster Kit', kind: 'folder' });
    toasterFolder.collapsed = false;
    const toasterDeviceId = `toaster-${crypto.randomUUID().slice(0, 8)}`;
    toasterFolder.devices = [
        {
            id: toasterDeviceId,
            name: 'Toaster',
            type: 'toaster',
            bypassed: false,
            parameterValues: {
                masterGain: 1,
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
        child.color = PAD_COLORS[i] ?? child.color;
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
    applyPreset(tSeqRipple, 'fermenter-seq-arp');

    applyPreset(tLeadMoog, 'fermenter-moog-lead');
    applyPreset(tLeadSync, 'fermenter-sync-lead');
    applyPreset(tBassGroove, 'fermenter-moog-bass');

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
    addDev(tSeqRipple, 'builtin-filter', 'Ripple Filter', {
        'filter-cutoff': 8000,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(tSeqRipple, 'builtin-distortion', 'Ripple Drive', {
        'dist-drive': 2.5,
        'dist-tone': 2800,
        'dist-mix': 0.14,
    });

    // Leads — center-weighted space, not too wet (clarity in the mid)
    addDev(tLeadMoog, 'builtin-delay', 'Lead Dotted', {
        'delay-time': 375,
        'delay-feedback': 0.32,
        'delay-mix': 0.18,
    });
    addDev(tLeadMoog, 'builtin-chorus', 'Lead Width', {
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
    addDev(tBassGroove, 'builtin-eq', 'Bass Pocket', {
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

    tSubDrone.gain = 0.02;
    tDarkMist.gain = 1;
    tGrainHaze.gain = 1;
    tEtherealVeil.gain = 1;
    tSweepHorizon.gain = 1;
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
    tLevHigh.gain = 1;
    tLevMid.gain = 1;
    tLevLow.gain = 1;
    tLevCall.gain = 1;
    tLevAnswer.gain = 1;
    toasterFolder.gain = 1;

    tSubDrone.pan = nextPan();
    tDarkMist.pan = nextPan();
    tGrainHaze.pan = nextPan();
    tEtherealVeil.pan = nextPan();
    tSweepHorizon.pan = nextPan();
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
    const cSeq = clip(tSeqRipple.id, 'Seq');
    const cLMo = clip(tLeadMoog.id, 'Moog');
    const cLSy = clip(tLeadSync.id, 'Sync');
    const cBss = clip(tBassGroove.id, 'Bass');
    const cLH = clip(tLevHigh.id, 'High');
    const cLM = clip(tLevMid.id, 'Mid');
    const cLL = clip(tLevLow.id, 'Low');
    const cLC = clip(tLevCall.id, 'Call');
    const cLA = clip(tLevAnswer.id, 'Answer');

    const padClips = toasterPadTracks.map((t, i) => clip(t.id, `Pad ${i}`));

    // ── MIDI content ──────────────────────────────────────────────────────
    const subN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 20) {
        subN.push(note(A2, b, 22, 86));
    }

    const darkN: MidiNote[] = [];
    for (let b = 6; b < TB; b += 28) {
        darkN.push(note(E3, b, 24, 74));
        darkN.push(note(A3, b + 5, 20, 68));
    }

    const grainN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 8) {
        grainN.push(note(G4 + ((b % 24) / 8) * 2, b, 6, 58 + (b % 5) * 3));
    }

    const veilN: MidiNote[] = [];
    for (let b = 2; b < TB; b += 16) {
        veilN.push(note(E5, b, 12, 56));
        veilN.push(note(C5, b + 7, 6, 50));
    }

    const sweepN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 6) {
        sweepN.push(note(A4, b, 4, 66));
        sweepN.push(note(D5, b + 3, 3.5, 62));
    }

    const warmN: MidiNote[] = [];
    for (let b = 12; b < TB; b += 40) {
        warmN.push(note(C4, b, 32, 70));
        warmN.push(note(E4, b + 14, 22, 64));
    }

    const riseN: MidiNote[] = [];
    for (let b = 18; b < TB; b += 14) {
        riseN.push(note(G4, b, 10, 58));
        riseN.push(note(B4, b + 7, 5, 52));
    }

    const wildN: MidiNote[] = [];
    const wildP = [D4, F4, A4, C5, E5, G4, A3, D5, Fs4, G4];
    for (let b = 0; b < TB; b += 4.25) {
        wildN.push(note(wildP[Math.floor(b) % wildP.length]!, b, 3.2, 54 + (Math.floor(b) % 9) * 2));
    }

    const stutterN: MidiNote[] = [];
    for (let b = 16; b < TB; b += 2.5) {
        if (b >= S.breakdown && b < S.final && Math.floor(b) % 8 === 0) {
            continue;
        }
        stutterN.push(note(C5, b, 0.35, 42 + (Math.floor(b) % 7) * 4));
    }

    const metalN: MidiNote[] = [];
    for (let b = 24; b < TB; b += 10.5) {
        metalN.push(note(E5, b, 0.15, 48));
    }

    const pluckN: MidiNote[] = [];
    const pluckPat = [A4, C5, E5, G4, D5, A4, B4, E5, C5, G4, A4, D5];
    let px = 0;
    for (let b = 8; b < TB - 2; b += 2.25) {
        const vel = b >= S.peak && b < S.breakdown ? 78 : 62;
        pluckN.push(note(pluckPat[px % pluckPat.length]!, b, 1.2, vel));
        px++;
    }

    const bellN: MidiNote[] = [];
    for (let b = 4; b < TB; b += 18) {
        bellN.push(note(G5, b, 3, 44));
        bellN.push(note(D5, b + 9, 2.5, 40));
    }

    const seqN: MidiNote[] = [];
    const seqPat = [E4, A4, C5, B4, G4, D5, E4, A3];
    let sx = 0;
    for (let b = 4; b < TB; b += 1.5) {
        if (b >= S.breakdown && b < S.final - 8 && Math.floor(b * 2) % 7 === 0) {
            sx++;
            continue;
        }
        seqN.push(note(seqPat[sx % seqPat.length]!, b, 0.45, 58));
        sx++;
    }

    const leadMoogN: MidiNote[] = [];
    const moogPhrase = [A4, C5, E5, A5, G5, E5, D5, C5, B4, A4, E5, D5, C5, A4];
    let mx = 0;
    let bm = 20;
    while (bm < TB - 8) {
        if (!(bm >= S.breakdown && bm < S.final - 12)) {
            leadMoogN.push(note(moogPhrase[mx % moogPhrase.length]!, bm, 2.4, 72 + (mx % 4) * 3));
        }
        mx++;
        const step = bm >= S.build1 && bm < S.breakdown ? 1.65 : 2.75;
        bm += step;
    }

    const leadSyncN: MidiNote[] = [];
    const syncPhrase = [E5, A5, G5, Fs5, E5, D5, E5, A4, C5, E5, D5, B4];
    let sy = 0;
    for (let b = 28; b < TB - 6; b += 2.2) {
        const thinBreakdown = b >= S.breakdown + 20 && b < S.final - 20 && Math.floor(b) % 5 === 0;
        if (thinBreakdown) {
            sy++;
            continue;
        }
        if (b >= S.build1) {
            leadSyncN.push(note(syncPhrase[sy % syncPhrase.length]!, b, 1.8, 68 + (sy % 5) * 2));
        }
        sy++;
    }

    const bassN: MidiNote[] = [];
    for (let b = S.build1; b < TB; b += 2) {
        const step = Math.floor(b / 2) % 8;
        const roots = [A2, A2, E3, A2, G2, A2, D3, E3];
        const root = roots[step] ?? A2;
        const dur = b >= S.peak && b < S.breakdown ? 1.85 : 1.45;
        bassN.push(note(root, b, dur, 76));
    }

    const highN: MidiNote[] = [];
    const highMelody = [E5, G5, A5, G5, E5, D5, C5, A4, E5, G5, E5, D5, C5, G4, A4, C5];
    let hi = 0;
    for (let b = 14; b < TB - 4; b += 3.2) {
        highN.push(note(highMelody[hi % highMelody.length]!, b, 2.6, 62 + (hi % 5) * 2));
        hi++;
    }

    const midN: MidiNote[] = [];
    const midMelody = [A4, C5, A4, G4, E4, D4, E4, G4, A4, C5, D5, C5, A4, G4, E4, A4];
    let mi = 0;
    for (let b = 10; b < TB - 6; b += 3.8) {
        midN.push(note(midMelody[mi % midMelody.length]!, b, 3.4, 68));
        mi++;
    }

    const lowN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 9) {
        lowN.push(note(A3, b, 7, 76));
        lowN.push(note(E3, b + 4.5, 4, 70));
    }

    const callN: MidiNote[] = [];
    for (let b = 24; b < TB; b += 26) {
        callN.push(note(D5, b, 5.5, 64));
        callN.push(note(A4, b + 9, 4.5, 58));
        callN.push(note(E5, b + 17, 3.5, 56));
    }

    const answerN: MidiNote[] = [];
    for (let b = 36; b < TB; b += 28) {
        answerN.push(note(C5, b, 5, 60));
        answerN.push(note(G4, b + 11, 4, 54));
        answerN.push(note(E4, b + 20, 5.5, 58));
    }

    const padMidi: MidiNote[][] = Array.from({ length: 16 }, () => []);
    const p = (pad: number, b: number, vel: number, dur = 0.12) => {
        padMidi[pad]!.push(note(60, b, dur, vel));
    };

    for (let b = S.build1; b < TB; b += 4) {
        const intense = b >= S.peak && b < S.breakdown;
        const sparse = b >= S.breakdown && b < S.final;
        if (!sparse || b % 8 === 0) {
            p(0, b, intense ? 82 : 58);
        }
        if ((b + 2) % 8 === 0 && (!sparse || b % 16 === 2)) {
            p(1, b + 0.25, intense ? 68 : 48);
        }
        if (!sparse || b % 4 === 0) {
            const hVel = intense ? 40 : 28;
            if (b % 2 === 0) {
                p(2, b + 0.5, hVel);
            }
            if (intense && b % 4 === 2) {
                p(3, b + 1.5, 36);
            }
        }
        if (b % 16 === 8 && !sparse) {
            p(4, b, 52);
        }
        if (b % 24 === 12) {
            p(5, b, 44);
        }
        if (intense && b % 6 === 3) {
            p(6, b, 38);
        }
        if (b % 32 === 4) {
            p(8, b, 42);
        }
        if (b % 20 === 10) {
            p(10, b, 36);
        }
        if (intense && b % 8 === 4) {
            p(12, b, 34);
        }
        if (b % 28 === 6) {
            p(14, b, 32);
        }
        if (b % 40 === 0) {
            p(15, b, 30);
        }
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
        t.clips = [padClips[i]!];
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
    padClips.forEach((pc, i) => {
        notesByClipId[pc.id] = padMidi[i] ?? [];
    });

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

    const padGainLanes = toasterPadTracks.map((pad, i) =>
        Object.assign(mkLane(pad.id, 'gain', `${pad.name} pad`, 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 70 + i, value: 0, curve: 'linear', tension: 0 },
                { beat: 98 + i, value: 0.42 + (i % 5) * 0.06, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.38 + (i % 4) * 0.07, curve: 'smooth', tension: 0.32 },
                { beat: S.breakdown, value: 0.14 + (i % 3) * 0.04, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.52 + (i % 4) * 0.05, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.32 + (i % 5) * 0.04, curve: 'linear', tension: 0 },
            ],
        })
    );

    const lanes = [
        // Gain orchestration — slow reveals; few parts forward at once; sub capped at 5%
        Object.assign(mkLane(tSubDrone.id, 'gain', 'Sub (≤5%)', 0, 0.05), {
            points: subDroneGainKeyframes(TB),
        }),
        Object.assign(mkLane(tDarkMist.id, 'gain', 'Mist level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 10, value: 0.08, curve: 'smooth', tension: 0.35 },
                { beat: 44, value: 0.38, curve: 'smooth', tension: 0.32 },
                { beat: S.build1, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.42, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.22, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.36, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainHaze.id, 'gain', 'Grain level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 22, value: 0, curve: 'linear', tension: 0 },
                { beat: 52, value: 0.32, curve: 'smooth', tension: 0.38 },
                { beat: 110, value: 0.55, curve: 'smooth', tension: 0.3 },
                { beat: S.peak, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.35 },
                { beat: S.final, value: 0.44, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.34, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tEtherealVeil.id, 'gain', 'Veil level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 34, value: 0, curve: 'linear', tension: 0 },
                { beat: 62, value: 0.28, curve: 'smooth', tension: 0.36 },
                { beat: 128, value: 0.46, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.38, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.18, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.32, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSweepHorizon.id, 'gain', 'Sweep level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 40, value: 0, curve: 'linear', tension: 0 },
                { beat: 68, value: 0.26, curve: 'smooth', tension: 0.35 },
                { beat: S.build1, value: 0.44, curve: 'linear', tension: 0 },
                { beat: 168, value: 0.52, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.36, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWarmHalo.id, 'gain', 'Halo level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 26, value: 0, curve: 'linear', tension: 0 },
                { beat: 54, value: 0.3, curve: 'smooth', tension: 0.36 },
                { beat: 118, value: 0.5, curve: 'smooth', tension: 0.28 },
                { beat: S.peak, value: 0.4, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.24, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.38, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tRisingMist.id, 'gain', 'Rising level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 48, value: 0, curve: 'linear', tension: 0 },
                { beat: 76, value: 0.24, curve: 'smooth', tension: 0.35 },
                { beat: 142, value: 0.42, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.2, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.4, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tWildDrift.id, 'gain', 'Wild level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 58, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0.22, curve: 'smooth', tension: 0.36 },
                { beat: S.peak, value: 0.46, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.26, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.34, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tGrainStutter.id, 'gain', 'Stutter level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 86, value: 0, curve: 'linear', tension: 0 },
                { beat: 112, value: 0.28, curve: 'smooth', tension: 0.38 },
                { beat: 188, value: 0.46, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.16, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.36, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.26, curve: 'linear', tension: 0 },
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
                { beat: 104, value: 0.32, curve: 'smooth', tension: 0.36 },
                { beat: 176, value: 0.52, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.18, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.42, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBellDust.id, 'gain', 'Bell level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 92, value: 0, curve: 'linear', tension: 0 },
                { beat: 118, value: 0.24, curve: 'smooth', tension: 0.35 },
                { beat: S.peak, value: 0.38, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.16, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.28, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'gain', 'Seq level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 64, value: 0, curve: 'linear', tension: 0 },
                { beat: 90, value: 0.3, curve: 'smooth', tension: 0.38 },
                { beat: S.build1, value: 0.46, curve: 'linear', tension: 0 },
                { beat: 200, value: 0.5, curve: 'smooth', tension: 0.28 },
                { beat: S.breakdown, value: 0.2, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: 0.36, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'gain', 'Moog lead', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 50, value: 0, curve: 'linear', tension: 0 },
                { beat: 78, value: 0.22, curve: 'smooth', tension: 0.35 },
                { beat: 118, value: 0.12, curve: 'linear', tension: 0 },
                { beat: 162, value: 0.68, curve: 'smooth', tension: 0.32 },
                { beat: S.breakdown, value: 0.1, curve: 'smooth', tension: 0.28 },
                { beat: S.final, value: 0.58, curve: 'smooth', tension: 0.35 },
                { beat: TB, value: 0.18, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadSync.id, 'gain', 'Sync lead', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 84, value: 0, curve: 'linear', tension: 0 },
                { beat: 108, value: 0.18, curve: 'smooth', tension: 0.35 },
                { beat: 156, value: 0.62, curve: 'smooth', tension: 0.3 },
                { beat: S.breakdown, value: 0.12, curve: 'linear', tension: 0 },
                { beat: S.final, value: 0.52, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.24, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBassGroove.id, 'gain', 'Bass level', 0, 1), {
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
                { beat: 92, value: 0.32, curve: 'smooth', tension: 0.38 },
                { beat: S.peak, value: 0.72, curve: 'linear', tension: 0 },
                { beat: S.breakdown, value: 0.22, curve: 'smooth', tension: 0.3 },
                { beat: S.final, value: 0.62, curve: 'smooth', tension: 0.32 },
                { beat: TB, value: 0.34, curve: 'linear', tension: 0 },
            ],
        }),
        // Levain — one hero at a time; everyone else tucked down
        Object.assign(mkLane(tLevHigh.id, 'gain', 'Levain High spot', 0, 1), {
            points: [
                { beat: 0, value: dim, curve: 'linear', tension: 0 },
                { beat: 6, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 68, value: hero, curve: 'linear', tension: 0 },
                { beat: 76, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevMid.id, 'gain', 'Levain Mid spot', 0, 1), {
            points: [
                { beat: 0, value: dim, curve: 'linear', tension: 0 },
                { beat: 74, value: dim, curve: 'linear', tension: 0 },
                { beat: 80, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 144, value: hero, curve: 'linear', tension: 0 },
                { beat: 152, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevLow.id, 'gain', 'Levain Low spot', 0, 1), {
            points: [
                { beat: 0, value: dim, curve: 'linear', tension: 0 },
                { beat: 150, value: dim, curve: 'linear', tension: 0 },
                { beat: 156, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 220, value: hero, curve: 'linear', tension: 0 },
                { beat: 228, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevCall.id, 'gain', 'Levain Call spot', 0, 1), {
            points: [
                { beat: 0, value: dim, curve: 'linear', tension: 0 },
                { beat: 226, value: dim, curve: 'linear', tension: 0 },
                { beat: 232, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 296, value: hero, curve: 'linear', tension: 0 },
                { beat: 304, value: dim, curve: 'smooth', tension: 0.3 },
                { beat: TB, value: dim, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLevAnswer.id, 'gain', 'Levain Answer spot', 0, 1), {
            points: [
                { beat: 0, value: dim, curve: 'linear', tension: 0 },
                { beat: 302, value: dim, curve: 'linear', tension: 0 },
                { beat: 308, value: hero, curve: 'smooth', tension: 0.3 },
                { beat: 372, value: hero, curve: 'linear', tension: 0 },
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
                { beat: 0, value: 0.55, curve: 'linear', tension: 0 },
                { beat: 190, value: 0.12, curve: 'smooth', tension: 0.45 },
                { beat: TB, value: 0.88, curve: 'smooth', tension: 0.4 },
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
        Object.assign(mkLane(tSeqRipple.id, 'filter-cutoff', 'Ripple cutoff', 100, 12000), {
            points: [
                { beat: 32, value: 3200, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 9800, curve: 'exponential', tension: 0.3 },
                { beat: S.breakdown, value: 1400, curve: 'exponential', tension: 0.35 },
                { beat: TB, value: 7200, curve: 'smooth', tension: 0.36 },
            ],
        }),
        Object.assign(mkLane(tSeqRipple.id, 'pan', 'Seq pan', 0, 1), {
            points: [
                { beat: 0, value: 0.72, curve: 'linear', tension: 0 },
                { beat: 220, value: 0.28, curve: 's-curve', tension: 0.5 },
                { beat: TB, value: 0.68, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tLeadMoog.id, 'pan', 'Moog pan', 0, 1), {
            points: [
                { beat: S.build1, value: 0.48, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 0.52, curve: 'smooth', tension: 0.2 },
                { beat: S.breakdown, value: 0.45, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
            ],
        }),
        Object.assign(mkLane(tBassGroove.id, 'pan', 'Bass pan', 0, 1), {
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
                { beat: S.build1, value: 0.85, curve: 'linear', tension: 0 },
                { beat: S.peak, value: 1.15, curve: 'exponential', tension: 0.25 },
                { beat: S.breakdown, value: 0.75, curve: 'linear', tension: 0 },
                { beat: TB, value: 0.95, curve: 'linear', tension: 0 },
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
