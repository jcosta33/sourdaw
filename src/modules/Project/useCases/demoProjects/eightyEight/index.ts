import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { projectStore } from '../../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { createTrack, createAutomationLane } from '#/modules/Arrangement/useCases/trackQueries';
import type { MidiNote } from '#/modules/Arrangement/useCases/trackQueries';
import { note, applyPreset, createMidiClip, generateDemoDrumBuffer, syncArrangement } from '../demoUtils';

// ---------------------------------------------------------------------------
// Demo Project 2: Psytrance — "Psyloops"
// Key: A minor | BPM: 142 | ~5:04 (720 beats)
// Structure: Intro(0-64) → Build(64-128) → Drop A(128-256) →
//            Breakdown(256-320) → Drop B(320-448) → Chaos(448-512) →
//            Breakdown 2(512-576) → Final Drop(576-720)
// 28 tracks across 7 folders
// ---------------------------------------------------------------------------
export async function demo2_ElectronicBeat(): Promise<void> {
    const bpm = 142;
    const TB = 720;

    const BASS_ROOTS = [33, 29, 36, 31]; // A1 F1 C2 G1
    const CHORD_TONES: number[][] = [
        [57, 60, 64, 67], // Am7
        [53, 57, 60, 64], // Fmaj7
        [60, 64, 67, 71], // Cmaj7
        [55, 59, 62, 66], // G7
    ];
    const PAD_TONES: number[][] = [
        [45, 48, 52, 55],
        [41, 45, 48, 52],
        [48, 52, 55, 59],
        [43, 47, 50, 55],
    ];

    const ci = (b: number) => Math.floor(b / 16) % 4;
    const br = (b: number) => BASS_ROOTS[ci(b)]!;
    const ct = (b: number) => CHORD_TONES[ci(b)]!;
    const pt = (b: number) => PAD_TONES[ci(b)]!;
    const hv = (base: number, r = 6) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));
    const R = (b: number, lo: number, hi: number) => b >= lo && b < hi;

    const isDrop = (b: number) => R(b, 128, 256) || R(b, 320, 448) || R(b, 576, TB);
    const isBuild = (b: number) => R(b, 64, 128);
    const isBD = (b: number) => R(b, 256, 320) || R(b, 512, 576);
    const isChaos = (b: number) => R(b, 448, 512);

    // ── TRACKS ───────────────────────────────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    // 🥁 Drums
    const drumFolder = createTrack({ name: '🥁 Drums', kind: 'folder' });
    const drumTrack = createTrack({ name: '808 Kit', kind: 'midi', parentId: drumFolder.id });
    const percTrack = createTrack({ name: 'Percussion', kind: 'midi', parentId: drumFolder.id });
    const hatTrack = createTrack({ name: 'Open Hat', kind: 'midi', parentId: drumFolder.id });
    const fillTrack = createTrack({ name: 'Drum Fills', kind: 'midi', parentId: drumFolder.id });

    // 🎸 Bass
    const bassFolder = createTrack({ name: '🎸 Bass', kind: 'folder' });
    const acidTrack = createTrack({ name: 'Acid 303', kind: 'midi', parentId: bassFolder.id });
    const subTrack = createTrack({ name: 'Sub Bass', kind: 'midi', parentId: bassFolder.id });
    const pulseTrack = createTrack({ name: 'Pulse Bass', kind: 'midi', parentId: bassFolder.id });

    // 🎹 Synths
    const synthFolder = createTrack({ name: '🎹 Synths', kind: 'folder' });
    const padTrack = createTrack({ name: 'Dark Pad', kind: 'midi', parentId: synthFolder.id });
    const ssTrack = createTrack({ name: 'Supersaw', kind: 'midi', parentId: synthFolder.id });
    const arpTrack = createTrack({ name: 'Arp Synth', kind: 'midi', parentId: synthFolder.id });

    // 🎵 Leads
    const leadFolder = createTrack({ name: '🎵 Leads', kind: 'folder' });
    const leadTrack = createTrack({ name: 'Trance Lead', kind: 'midi', parentId: leadFolder.id });
    const lead2Track = createTrack({ name: 'Formant Lead', kind: 'midi', parentId: leadFolder.id });
    const brassTrack = createTrack({ name: 'Brass Stab', kind: 'midi', parentId: leadFolder.id });

    // 🔊 FX
    const fxFolder = createTrack({ name: '🔊 FX', kind: 'folder' });
    const sweepTrack = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const stabTrack = createTrack({ name: 'Stab FX', kind: 'midi', parentId: fxFolder.id });
    const riserTrack = createTrack({ name: 'Riser', kind: 'midi', parentId: fxFolder.id });

    // ✨ Textures
    const texFolder = createTrack({ name: '✨ Textures', kind: 'folder' });
    const bellAccTrack = createTrack({ name: 'Bell Accents', kind: 'midi', parentId: texFolder.id });
    const crystalTrack = createTrack({ name: 'Crystal Arp', kind: 'midi', parentId: texFolder.id });
    const pluckTrack = createTrack({ name: 'Pluck Layer', kind: 'midi', parentId: texFolder.id });

    // 🌊 Atmosphere
    const atmosFolder = createTrack({ name: '🌊 Atmosphere', kind: 'folder' });
    const droneTrack = createTrack({ name: 'Dark Drone', kind: 'midi', parentId: atmosFolder.id });
    const shimTrack = createTrack({ name: 'Shimmer Pad', kind: 'midi', parentId: atmosFolder.id });
    const gravTrack = createTrack({ name: 'Gravity Wash', kind: 'midi', parentId: atmosFolder.id });

    // ── PRESETS ──────────────────────────────────────────────────────────────
    drumTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    fillTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    percTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    hatTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    applyPreset(acidTrack, 'factory-bass-acid');
    applyPreset(subTrack, 'factory-bass-sub');
    applyPreset(pulseTrack, 'factory-bass-pluck');
    applyPreset(padTrack, 'factory-pad-dark');
    applyPreset(ssTrack, 'factory-synth-supersaw');
    applyPreset(arpTrack, 'factory-synth-arp');
    applyPreset(leadTrack, 'factory-lead-detuned');
    applyPreset(lead2Track, 'factory-lead-formant');
    applyPreset(brassTrack, 'factory-synth-brass');
    applyPreset(sweepTrack, 'factory-fx-noise-sweep');
    applyPreset(stabTrack, 'factory-fx-stab');
    applyPreset(riserTrack, 'factory-fx-riser');
    applyPreset(bellAccTrack, 'factory-keys-bell');
    applyPreset(crystalTrack, 'factory-keys-marimba');
    applyPreset(pluckTrack, 'factory-keys-pluck');
    applyPreset(droneTrack, 'factory-pad-dark');
    applyPreset(shimTrack, 'factory-pad-warm');
    applyPreset(gravTrack, 'factory-faust-fm-pad');

    // ── DEVICE FX HELPER ─────────────────────────────────────────────────────
    const addDev = (t: any, type: string, name: string, params: Record<string, number>) => {
        t.devices = [
            ...(t.devices ?? []),
            { id: `dev-${crypto.randomUUID()}`, name, type, bypassed: false, parameterValues: params },
        ];
    };

    // Master chain
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 2,
        'eq-low-freq': 80,
        'eq-low-q': 0.9,
        'eq-mid-gain': -1.5,
        'eq-mid-freq': 500,
        'eq-mid-q': 1.2,
        'eq-high-gain': 1.5,
        'eq-high-freq': 10000,
        'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -10,
        'comp-ratio': 2.5,
        'comp-attack': 25,
        'comp-release': 180,
        'comp-knee': 8,
        'comp-makeup': 1.5,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.2,
        'width-mid': 0,
        'width-side': 1.4,
        'width-mono-bass': 150,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -0.5 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -14 });

    // Per-track FX
    addDev(drumTrack, 'builtin-eq', 'Drum EQ', {
        'eq-low-gain': 4,
        'eq-low-freq': 55,
        'eq-low-q': 1.1,
        'eq-mid-gain': -3,
        'eq-mid-freq': 400,
        'eq-mid-q': 1.5,
        'eq-high-gain': 2,
        'eq-high-freq': 8000,
        'eq-high-q': 0.7,
    });
    addDev(drumTrack, 'builtin-compressor', 'Drum Punch', {
        'comp-threshold': -14,
        'comp-ratio': 4,
        'comp-attack': 8,
        'comp-release': 100,
        'comp-knee': 4,
        'comp-makeup': 3,
    });
    addDev(acidTrack, 'builtin-distortion', 'Acid Drive', {
        'dist-drive': 4,
        'dist-tone': 1800,
        'dist-mix': 0.18,
        'dist-output': -2,
    });
    addDev(acidTrack, 'builtin-delay', 'Acid Echo', { 'delay-time': 212, 'delay-feedback': 0.35, 'delay-mix': 0.18 });
    addDev(leadTrack, 'builtin-chorus', 'Lead Chorus', {
        'chorus-rate': 0.5,
        'chorus-depth': 6,
        'chorus-feedback': 0.2,
        'chorus-mix': 0.3,
    });
    addDev(leadTrack, 'builtin-delay', 'Lead Delay', { 'delay-time': 338, 'delay-feedback': 0.3, 'delay-mix': 0.22 });
    addDev(leadTrack, 'builtin-reverb', 'Lead Space', {
        'rev-size': 0.5,
        'rev-decay': 2,
        'rev-damping': 0.35,
        'rev-mix': 0.2,
    });
    addDev(lead2Track, 'builtin-phaser', 'Formant Phase', {
        'phaser-rate': 0.2,
        'phaser-depth': 0.7,
        'phaser-feedback': 0.5,
        'phaser-stages': 6,
    });
    addDev(lead2Track, 'builtin-reverb', 'Formant Hall', {
        'rev-size': 0.6,
        'rev-decay': 2.5,
        'rev-damping': 0.3,
        'rev-mix': 0.25,
    });
    addDev(ssTrack, 'builtin-chorus', 'SS Wide', {
        'chorus-rate': 0.12,
        'chorus-depth': 12,
        'chorus-feedback': 0.25,
        'chorus-mix': 0.4,
    });
    addDev(ssTrack, 'builtin-reverb', 'SS Hall', {
        'rev-size': 0.55,
        'rev-decay': 1.8,
        'rev-damping': 0.4,
        'rev-mix': 0.2,
    });
    addDev(arpTrack, 'builtin-delay', 'Arp Delay', { 'delay-time': 212, 'delay-feedback': 0.45, 'delay-mix': 0.28 });
    addDev(arpTrack, 'builtin-phaser', 'Arp Phase', {
        'phaser-rate': 0.25,
        'phaser-depth': 0.5,
        'phaser-feedback': 0.4,
        'phaser-stages': 4,
    });
    addDev(padTrack, 'builtin-phaser', 'Pad Phase', {
        'phaser-rate': 0.07,
        'phaser-depth': 0.9,
        'phaser-feedback': 0.6,
        'phaser-stages': 6,
    });
    addDev(padTrack, 'builtin-reverb', 'Pad Hall', {
        'rev-size': 0.85,
        'rev-decay': 5,
        'rev-damping': 0.15,
        'rev-mix': 0.3,
    });
    addDev(brassTrack, 'builtin-reverb', 'Brass Hall', {
        'rev-size': 0.6,
        'rev-decay': 2,
        'rev-damping': 0.3,
        'rev-mix': 0.25,
    });
    addDev(sweepTrack, 'builtin-filter', 'Sweep Filter', {
        'filter-cutoff': 800,
        'filter-resonance': 5,
        'filter-type': 0,
    });
    addDev(sweepTrack, 'builtin-reverb', 'Sweep Space', {
        'rev-size': 0.9,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.4,
    });
    addDev(stabTrack, 'builtin-distortion', 'Stab Drive', { 'dist-drive': 3, 'dist-tone': 2500, 'dist-mix': 0.12 });
    addDev(riserTrack, 'builtin-filter', 'Rise Filter', {
        'filter-cutoff': 400,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(riserTrack, 'builtin-reverb', 'Rise Space', {
        'rev-size': 0.85,
        'rev-decay': 3.5,
        'rev-damping': 0.25,
        'rev-mix': 0.35,
    });
    addDev(bellAccTrack, 'builtin-delay', 'Bell Echo', { 'delay-time': 423, 'delay-feedback': 0.4, 'delay-mix': 0.3 });
    addDev(bellAccTrack, 'builtin-reverb', 'Bell Hall', {
        'rev-size': 0.8,
        'rev-decay': 3,
        'rev-damping': 0.2,
        'rev-mix': 0.35,
    });
    addDev(crystalTrack, 'builtin-delay', 'Crystal Delay', {
        'delay-time': 169,
        'delay-feedback': 0.5,
        'delay-mix': 0.35,
    });
    addDev(crystalTrack, 'builtin-autopan', 'Crystal Pan', { 'autopan-rate': 0.4, 'autopan-depth': 0.6 });
    addDev(pluckTrack, 'builtin-delay', 'Pluck Echo', { 'delay-time': 338, 'delay-feedback': 0.4, 'delay-mix': 0.28 });
    addDev(droneTrack, 'builtin-reverb', 'Drone Verb', {
        'rev-size': 1.0,
        'rev-decay': 12,
        'rev-damping': 0.05,
        'rev-mix': 0.6,
    });
    addDev(shimTrack, 'builtin-chorus', 'Shim Chorus', {
        'chorus-rate': 0.1,
        'chorus-depth': 14,
        'chorus-feedback': 0.25,
        'chorus-mix': 0.45,
    });
    addDev(shimTrack, 'builtin-reverb', 'Shim Hall', {
        'rev-size': 0.9,
        'rev-decay': 6,
        'rev-damping': 0.1,
        'rev-mix': 0.4,
    });
    addDev(gravTrack, 'builtin-flanger', 'Grav Flange', {
        'flanger-rate': 0.05,
        'flanger-depth': 6,
        'flanger-feedback': 0.4,
        'flanger-mix': 0.25,
    });
    addDev(gravTrack, 'builtin-reverb', 'Grav Verb', {
        'rev-size': 0.95,
        'rev-decay': 8,
        'rev-damping': 0.08,
        'rev-mix': 0.5,
    });
    addDev(pulseTrack, 'builtin-filter', 'Pulse Filter', {
        'filter-cutoff': 1200,
        'filter-resonance': 3,
        'filter-type': 0,
    });
    addDev(hatTrack, 'builtin-reverb', 'Hat Space', {
        'rev-size': 0.25,
        'rev-decay': 0.8,
        'rev-damping': 0.6,
        'rev-mix': 0.12,
    });

    // ── GAIN / PAN ───────────────────────────────────────────────────────────
    drumTrack.gain = 0.75;
    drumTrack.pan = 0;
    percTrack.gain = 0.5;
    percTrack.pan = -15;
    hatTrack.gain = 0.45;
    hatTrack.pan = 20;
    fillTrack.gain = 0.55;
    fillTrack.pan = 0;
    acidTrack.gain = 0.6;
    acidTrack.pan = -20;
    subTrack.gain = 0.7;
    subTrack.pan = 0;
    pulseTrack.gain = 0.45;
    pulseTrack.pan = 15;
    padTrack.gain = 0.5;
    padTrack.pan = 0;
    ssTrack.gain = 0.55;
    ssTrack.pan = 10;
    arpTrack.gain = 0.5;
    arpTrack.pan = -25;
    leadTrack.gain = 0.65;
    leadTrack.pan = 0;
    lead2Track.gain = 0.55;
    lead2Track.pan = 20;
    brassTrack.gain = 0.45;
    brassTrack.pan = -15;
    sweepTrack.gain = 0.45;
    sweepTrack.pan = 0;
    stabTrack.gain = 0.5;
    stabTrack.pan = 0;
    riserTrack.gain = 0.4;
    riserTrack.pan = 0;
    bellAccTrack.gain = 0.2;
    bellAccTrack.pan = 35;
    crystalTrack.gain = 0.25;
    crystalTrack.pan = -35;
    pluckTrack.gain = 0.2;
    pluckTrack.pan = 40;
    droneTrack.gain = 0.3;
    droneTrack.pan = 0;
    shimTrack.gain = 0.25;
    shimTrack.pan = -20;
    gravTrack.gain = 0.28;
    gravTrack.pan = 25;

    // ── AUDIO BUFFERS ────────────────────────────────────────────────────────
    const cx = Date.now();
    const bShaker = `d2-shaker-${cx}`,
        bPerc = `d2-perc-${cx}`;
    await Promise.all([
        generateDemoDrumBuffer(bShaker, TB, bpm, 'shaker'),
        generateDemoDrumBuffer(bPerc, TB, bpm, 'hat'),
    ]);

    // ── CLIPS ────────────────────────────────────────────────────────────────
    const mkC = (t: any, name: string, s: number, e: number) => {
        const c = createMidiClip(t.id, name, s, e, t.color);
        t.clips = [...(t.clips ?? []), c];
        return c;
    };

    const dk1 = mkC(drumTrack, 'Intro Beat', 0, 64);
    const dk2 = mkC(drumTrack, 'Build Drums', 64, 128);
    const dk3 = mkC(drumTrack, 'Drop A', 128, 256);
    const dk4 = mkC(drumTrack, 'Drop B', 320, 448);
    const dk5 = mkC(drumTrack, 'Chaos', 448, 512);
    const dk6 = mkC(drumTrack, 'Final Drop', 576, TB);

    const percClip = mkC(percTrack, 'Perc Accents', 64, TB);
    const hatClip = mkC(hatTrack, 'Open Hat Acc', 64, TB);
    const fillClip = mkC(fillTrack, 'Drum Fills', 128, 576);
    const acidClip = mkC(acidTrack, 'Acid Line A', 64, 256);
    const acid2Clip = mkC(acidTrack, 'Acid Line B', 320, TB);
    const subClip = mkC(subTrack, 'Sub Foundation', 0, TB);
    const pulseClip = mkC(pulseTrack, 'Pulse Bass', 128, 576);
    const padClip = mkC(padTrack, 'Dark Atmos', 0, TB);
    const ssClip1 = mkC(ssTrack, 'SS Drop A', 128, 256);
    const ssClip2 = mkC(ssTrack, 'SS Drop B', 320, 512);
    const ssClip3 = mkC(ssTrack, 'SS Final', 576, TB);
    const arpClip = mkC(arpTrack, 'Psytrance Arp', 64, TB);
    const leadClip1 = mkC(leadTrack, 'Lead Drop A', 128, 256);
    const leadClip2 = mkC(leadTrack, 'Lead Drop B+', 320, 512);
    const leadClip3 = mkC(leadTrack, 'Lead Final', 576, TB);
    const l2Clip = mkC(lead2Track, 'Alt Melody', 320, 512);
    const brassClip = mkC(brassTrack, 'Brass Fanfare', 448, 576);
    const sweepClip = mkC(sweepTrack, 'Sweeps', 48, TB);
    const stabClip = mkC(stabTrack, 'Stabs', 128, 576);
    const riserClip = mkC(riserTrack, 'Risers', 0, TB);
    const bellClip = mkC(bellAccTrack, 'Bell Acc', 64, TB);
    const crystClip = mkC(crystalTrack, 'Crystal', 128, 576);
    const pluckClip = mkC(pluckTrack, 'Pluck', 64, 512);
    const droneClip = mkC(droneTrack, 'Drone', 0, TB);
    const shimClip = mkC(shimTrack, 'Shimmer', 0, TB);
    const gravClip = mkC(gravTrack, 'Gravity', 128, 576);

    // ── NOTE ARRAYS ──────────────────────────────────────────────────────────
    const drumN: MidiNote[] = [];
    const percN: MidiNote[] = [];
    const hatN: MidiNote[] = [];
    const fillN: MidiNote[] = [];
    const acidN: MidiNote[] = [];
    const subN: MidiNote[] = [];
    const pulseN: MidiNote[] = [];
    const padN: MidiNote[] = [];
    const ssN: MidiNote[] = [];
    const arpN: MidiNote[] = [];
    const leadN: MidiNote[] = [];
    const l2N: MidiNote[] = [];
    const brassN: MidiNote[] = [];
    const sweepN: MidiNote[] = [];
    const stabN: MidiNote[] = [];
    const riserN: MidiNote[] = [];
    const bellN: MidiNote[] = [];
    const crystN: MidiNote[] = [];
    const pluckN: MidiNote[] = [];
    const droneN: MidiNote[] = [];
    const shimN: MidiNote[] = [];
    const gravN: MidiNote[] = [];

    // ── DRUMS ────────────────────────────────────────────────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) {
            break;
        }
        const p = b % 4;
        const bar = Math.floor(b / 4);
        const inDrop = isDrop(b);
        const inBuild = isBuild(b);
        const inBD = isBD(b);
        const inChaos = isChaos(b);

        // Kick
        if (!inBD && !inChaos && p % 1 === 0) {
            const v = R(b, 0, 64) ? hv(75) : inBuild ? hv(95) : inDrop ? hv(112) : 0;
            if (v > 0) {
                drumN.push(note(36, b, 0.5, v));
            }
        }
        if (inChaos && (p === 0 || p === 0.5 || p === 1.75 || p === 2.5 || p === 3.25)) {
            drumN.push(note(36, b, 0.3, hv(95)));
        }
        if (inDrop && (p === 0.75 || p === 2.75) && bar % 2 === 0) {
            drumN.push(note(36, b, 0.25, hv(80)));
        }

        // Clap/Snare
        if ((p === 1 || p === 3) && (inDrop || inBuild)) {
            drumN.push(note(39, b, 0.25, hv(98)));
            if (inDrop) {
                drumN.push(note(38, b, 0.25, hv(72)));
            }
        }
        if (inBD && p === 2 && bar % 2 === 0) {
            drumN.push(note(37, b, 0.12, hv(50)));
        }

        // Closed HH
        if (inDrop && p % 0.25 === 0) {
            const acc = p % 1 === 0 ? 80 : p % 0.5 === 0 ? 55 : 32;
            drumN.push(note(42, b, 0.12, hv(acc)));
        } else if (inBuild && p % 0.5 === 0) {
            drumN.push(note(42, b, 0.12, hv(58)));
        } else if (R(b, 0, 64) && p % 1 === 0) {
            drumN.push(note(42, b, 0.12, hv(45)));
        }

        // Open HH accents
        if (inDrop && p === 0.5 && bar % 2 === 0) {
            hatN.push(note(46, b, 0.5, hv(62)));
        }
        if (inChaos && p === 2.5) {
            hatN.push(note(46, b, 0.3, hv(70)));
        }

        // Tom fills
        if (inDrop && b % 64 >= 60 && p % 0.5 === 0) {
            fillN.push(note(p < 2 ? 43 : p < 3 ? 47 : 50, b, 0.25, hv(78)));
        }

        // Perc
        if (b >= 64 && inDrop && p % 0.5 === 0.25 && bar % 4 < 2) {
            percN.push(note(56, b, 0.1, hv(42)));
        }
        if (R(b, 448, 512) && p % 0.25 === 0 && bar % 2 === 1) {
            percN.push(note(75, b, 0.1, hv(38)));
        }
        if (inDrop && bar % 8 >= 6 && p === 1.5) {
            percN.push(note(62, b, 0.15, hv(48)));
        }
    }

    // ── ACID BASS ────────────────────────────────────────────────────────────
    const acidPatA = [
        [0, 0, 0.25],
        [0.25, 12, 0.125],
        [0.5, 0, 0.25],
        [1, 0, 0.5],
        [1.5, -2, 0.25],
        [1.75, 0, 0.25],
        [2, 7, 0.25],
        [2.5, 0, 0.5],
        [3, 12, 0.25],
        [3.5, 7, 0.25],
        [3.75, 5, 0.25],
    ];
    const acidPatB = [
        [0, 0, 0.125],
        [0.25, 12, 0.125],
        [0.5, 7, 0.125],
        [0.75, 12, 0.125],
        [1, 0, 0.25],
        [1.25, 5, 0.25],
        [1.5, 7, 0.25],
        [1.75, 12, 0.25],
        [2, 0, 0.5],
        [2.5, 5, 0.125],
        [2.75, 7, 0.125],
        [3, 12, 0.25],
        [3.25, 0, 0.25],
        [3.5, 5, 0.5],
    ];
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || isBD(bs)) {
            continue;
        }
        const root = br(bs);
        const useB = isDrop(bs) && !R(bs, 128, 256);
        const pat = useB ? acidPatB : acidPatA;
        const v = isBuild(bs) ? 82 : isDrop(bs) ? 105 : 88;
        for (const [off, iv, dur] of pat) {
            if (bs + off! >= TB) {
                break;
            }
            acidN.push(note(root + iv!, bs + off!, dur!, hv(v)));
        }
    }

    // ── SUB BASS ─────────────────────────────────────────────────────────────
    for (let b = 0; b < TB; b += 2) {
        if (isBD(b)) {
            continue;
        }
        subN.push(note(br(b), b, 1.85, hv(88)));
    }

    // ── PULSE BASS ───────────────────────────────────────────────────────────
    const pulseOff = [0, 0.5, 1.5, 2, 3, 3.5];
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 128 || bs >= 576 || isBD(bs)) {
            continue;
        }
        const root = br(bs);
        for (const off of pulseOff) {
            pulseN.push(note(root + 12, bs + off, 0.4, hv(off === 0 || off === 2 ? 85 : 62)));
        }
    }

    // ── DARK PAD ─────────────────────────────────────────────────────────────
    for (let b = 0; b < TB; b += 16) {
        const tones = pt(b);
        const v = isBD(b) ? 80 : isDrop(b) ? 55 : R(b, 0, 64) ? 38 : 62;
        for (const t of tones) {
            padN.push(note(t, b, 15.8, hv(v)));
        }
    }

    // ── SUPERSAW ─────────────────────────────────────────────────────────────
    for (let b = 128; b < TB; b += 4) {
        if (isBD(b) || (b >= 256 && b < 320) || (b >= 512 && b < 576)) {
            continue;
        }
        const tones = ct(b);
        for (const t of tones) {
            ssN.push(note(t, b, 0.5, hv(88)));
            ssN.push(note(t, b + 2, 0.25, hv(68)));
        }
    }

    // ── ARP ──────────────────────────────────────────────────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 64 || b >= TB || isBD(b)) {
            continue;
        }
        const tones = ct(b);
        const idx = s % tones.length;
        const oct = Math.floor(s / tones.length) % 2 === 0 ? 0 : 12;
        arpN.push(note(tones[idx]! + oct, b, 0.2, isDrop(b) ? hv(68) : hv(52)));
    }

    // ── LEAD MELODY ──────────────────────────────────────────────────────────
    const melA: [number, number, number][] = [
        [0, 76, 1.5],
        [2, 74, 1],
        [3, 72, 1],
        [4, 69, 2],
        [6, 72, 1],
        [7, 74, 1],
        [8, 76, 1.5],
        [10, 79, 1],
        [11, 81, 1],
        [12, 79, 2],
        [14, 76, 2],
    ];
    const melB: [number, number, number][] = [
        [0, 81, 0.5],
        [0.5, 79, 0.5],
        [1, 76, 1],
        [2, 79, 0.5],
        [2.5, 81, 1.5],
        [4, 79, 1],
        [5, 76, 0.5],
        [5.5, 74, 0.5],
        [6, 72, 2],
        [8, 74, 1],
        [9, 76, 1],
        [10, 79, 2],
        [12, 81, 2],
        [14, 79, 2],
    ];
    for (let ph = 0; ph < (576 - 128) / 16; ph++) {
        const start = 128 + ph * 16;
        if (isBD(start)) {
            continue;
        }
        const mel = R(start, 128, 256) ? melA : melB;
        const rOff = [0, -4, 3, -2][ci(start)]!;
        for (const [off, pitch, dur] of mel) {
            if (start + off >= 576) {
                break;
            }
            leadN.push(note(pitch + rOff, start + off, dur, hv(93)));
        }
    }
    // Final drop: octave up
    for (let ph = 0; ph < (TB - 576) / 16; ph++) {
        const start = 576 + ph * 16;
        for (const [off, pitch, dur] of ph % 2 === 0 ? melA : melB) {
            leadN.push(note(pitch + 12, start + off, dur, hv(98)));
        }
    }

    // ── FORMANT LEAD ─────────────────────────────────────────────────────────
    const fMel: [number, number, number][] = [
        [0, 72, 2],
        [2, 76, 1],
        [3, 79, 1],
        [4, 81, 3],
        [7, 79, 1],
        [8, 76, 2],
        [10, 74, 1],
        [11, 72, 1],
        [12, 69, 4],
    ];
    for (let ph = 0; ph < (512 - 320) / 16; ph++) {
        for (const [off, pitch, dur] of fMel) {
            l2N.push(note(pitch, 320 + ph * 16 + off, dur, hv(84)));
        }
    }

    // ── BRASS STABS ──────────────────────────────────────────────────────────
    for (let b = 448; b < 576; b += 8) {
        const t = ct(b);
        brassN.push(note(t[0]! + 12, b, 0.5, hv(90)));
        brassN.push(note(t[2]! + 12, b + 0.1, 0.5, hv(85)));
    }

    // ── SWEEPS / STABS / RISERS ──────────────────────────────────────────────
    for (const sp of [48, 112, 304, 368, 448, 560]) {
        sweepN.push(note(60, sp, 16, 68));
    }
    for (let b = 128; b < 576; b += 8) {
        if (isBD(b)) {
            continue;
        }
        stabN.push(note(ct(b)[0]! + 12, b, 0.1, hv(98)));
    }
    for (let b = 16; b < TB; b += 64) {
        riserN.push(note(50 + Math.floor((b % 64) * 0.4), b, 15.8, hv(45 + Math.floor((b / TB) * 30))));
    }

    // ── TEXTURES ─────────────────────────────────────────────────────────────
    for (let b = 64; b < TB; b += 8) {
        if (isBD(b)) {
            continue;
        }
        const c = ct(b);
        bellN.push(note(c[3]! + 24, b + 1, 2, hv(35)));
    }
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 128 || b >= 576 || isBD(b)) {
            continue;
        }
        const t = ct(b);
        crystN.push(note(t[s % t.length]! + 12, b, 0.18, hv(42)));
    }
    const pluckOff = [0, 0.5, 1.5, 3, 3.5];
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || bs >= 512 || isBD(bs)) {
            continue;
        }
        const r = br(bs);
        for (const off of pluckOff) {
            pluckN.push(note(r + 12, bs + off, 0.3, hv(55)));
        }
    }

    // ── ATMOSPHERE ───────────────────────────────────────────────────────────
    for (let b = 0; b < TB; b += 32) {
        const t = pt(b);
        for (const p of t.slice(0, 3)) {
            droneN.push(note(p - 12, b, 31.5, hv(32)));
        }
    }
    for (let b = 0; b < TB; b += 16) {
        const t = pt(b);
        for (const p of t) {
            shimN.push(note(p + 12, b, 15.8, hv(isBD(b) ? 30 : 45)));
        }
    }
    for (let b = 128; b < 576; b += 16) {
        if (isBD(b)) {
            continue;
        }
        const t = ct(b);
        for (const p of t) {
            gravN.push(note(p, b, 15.5, hv(38)));
        }
    }

    // ── ASSEMBLE ─────────────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        drumFolder,
        drumTrack,
        percTrack,
        hatTrack,
        fillTrack,
        bassFolder,
        acidTrack,
        subTrack,
        pulseTrack,
        synthFolder,
        padTrack,
        ssTrack,
        arpTrack,
        leadFolder,
        leadTrack,
        lead2Track,
        brassTrack,
        fxFolder,
        sweepTrack,
        stabTrack,
        riserTrack,
        texFolder,
        bellAccTrack,
        crystalTrack,
        pluckTrack,
        atmosFolder,
        droneTrack,
        shimTrack,
        gravTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: leadTrack.id });

    // Note mapping helper: map absolute beats to clip-relative
    const rel = (notes: MidiNote[], start: number) =>
        notes.filter((n) => n.startBeat >= start).map((n) => ({ ...n, startBeat: n.startBeat - start }));
    const flt = (notes: MidiNote[], lo: number, hi: number) =>
        notes.filter((n) => n.startBeat >= lo && n.startBeat < hi);

    midiStore.set({
        notesByClipId: {
            [dk1.id]: rel(flt(drumN, 0, 64), 0),
            [dk2.id]: rel(flt(drumN, 64, 128), 64),
            [dk3.id]: rel(flt(drumN, 128, 256), 128),
            [dk4.id]: rel(flt(drumN, 320, 448), 320),
            [dk5.id]: rel(flt(drumN, 448, 512), 448),
            [dk6.id]: rel(flt(drumN, 576, TB), 576),
            [percClip.id]: rel(percN, 64),
            [hatClip.id]: rel(hatN, 64),
            [fillClip.id]: rel(flt(fillN, 128, 576), 128),
            [acidClip.id]: rel(flt(acidN, 64, 256), 64),
            [acid2Clip.id]: rel(flt(acidN, 320, TB), 320),
            [subClip.id]: subN,
            [pulseClip.id]: rel(flt(pulseN, 128, 576), 128),
            [padClip.id]: padN,
            [ssClip1.id]: rel(flt(ssN, 128, 256), 128),
            [ssClip2.id]: rel(flt(ssN, 320, 512), 320),
            [ssClip3.id]: rel(flt(ssN, 576, TB), 576),
            [arpClip.id]: rel(arpN, 64),
            [leadClip1.id]: rel(flt(leadN, 128, 256), 128),
            [leadClip2.id]: rel(flt(leadN, 320, 512), 320),
            [leadClip3.id]: rel(flt(leadN, 576, TB), 576),
            [l2Clip.id]: rel(l2N, 320),
            [brassClip.id]: rel(brassN, 448),
            [sweepClip.id]: sweepN,
            [stabClip.id]: rel(flt(stabN, 128, 576), 128),
            [riserClip.id]: riserN,
            [bellClip.id]: rel(bellN, 64),
            [crystClip.id]: rel(flt(crystN, 128, 576), 128),
            [pluckClip.id]: rel(flt(pluckN, 64, 512), 64),
            [droneClip.id]: droneN,
            [shimClip.id]: shimN,
            [gravClip.id]: rel(flt(gravN, 128, 576), 128),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION ───────────────────────────────────────────────────────────
    const mkLane = (id: string, p: string, l: string, mn: number, mx: number) => createAutomationLane(id, p, l, mn, mx);

    const padVol = mkLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVol.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.9, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.15, curve: 'linear', tension: 0 },
    ];

    const arpVol = mkLane(arpTrack.id, 'volume', 'Volume', 0, 1);
    arpVol.points = [
        { beat: 64, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.78, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.85, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const ssVol = mkLane(ssTrack.id, 'volume', 'Volume', 0, 1);
    ssVol.points = [
        { beat: 128, value: 0, curve: 'linear', tension: 0 },
        { beat: 144, value: 0.72, curve: 'linear', tension: 0 },
        { beat: 248, value: 0.72, curve: 'linear', tension: 0 },
        { beat: 256, value: 0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 336, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.9, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const acidVol = mkLane(acidTrack.id, 'volume', 'Volume', 0, 1);
    acidVol.points = [
        { beat: 64, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 256, value: 0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.95, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const leadVol = mkLane(leadTrack.id, 'volume', 'Volume', 0, 1);
    leadVol.points = [
        { beat: 128, value: 0, curve: 'linear', tension: 0 },
        { beat: 136, value: 0.88, curve: 'linear', tension: 0 },
        { beat: 248, value: 0.88, curve: 'linear', tension: 0 },
        { beat: 256, value: 0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 328, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.95, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const drumVol = mkLane(drumTrack.id, 'volume', 'Volume', 0, 1);
    drumVol.points = [
        { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 128, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 252, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 256, value: 0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.95, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const subVol = mkLane(subTrack.id, 'volume', 'Volume', 0, 1);
    subVol.points = [
        { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.95, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.1, curve: 'linear', tension: 0 },
    ];

    const droneVol = mkLane(droneTrack.id, 'volume', 'Volume', 0, 1);
    droneVol.points = [
        { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 448, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.8, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.4, curve: 'linear', tension: 0 },
    ];

    const shimVol = mkLane(shimTrack.id, 'volume', 'Volume', 0, 1);
    shimVol.points = [
        { beat: 0, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.8, curve: 'linear', tension: 0 },
    ];

    const l2Vol = mkLane(lead2Track.id, 'volume', 'Volume', 0, 1);
    l2Vol.points = [
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 332, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 504, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 512, value: 0, curve: 'linear', tension: 0 },
    ];

    // Dramatic FX automation
    const acidDelayFb = mkLane(acidTrack.id, 'delay-feedback', 'Delay FB', 0, 0.95);
    acidDelayFb.points = [
        { beat: 64, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 200, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 220, value: 0.78, curve: 'linear', tension: 0 },
        { beat: 248, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 440, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.08, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.45, curve: 'linear', tension: 0 },
    ];

    const padRevMix = mkLane(padTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    padRevMix.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.06, curve: 'linear', tension: 0 },
        { beat: 448, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.65, curve: 'linear', tension: 0 },
    ];

    const arpDelayFb = mkLane(arpTrack.id, 'delay-mix', 'Delay Mix', 0, 1);
    arpDelayFb.points = [
        { beat: 64, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.28, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 248, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.45, curve: 'linear', tension: 0 },
    ];

    const gravRevMix = mkLane(gravTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    gravRevMix.points = [
        { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.08, curve: 'linear', tension: 0 },
        { beat: 448, value: 0.5, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            padVol,
            arpVol,
            ssVol,
            acidVol,
            leadVol,
            drumVol,
            subVol,
            droneVol,
            shimVol,
            l2Vol,
            acidDelayFb,
            padRevMix,
            arpDelayFb,
            gravRevMix,
        ],
    });

    // ── MARKERS / SECTIONS ───────────────────────────────────────────────────
    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: 'oklch(0.35 0.10 280)' },
            { id: crypto.randomUUID(), beat: 32, name: 'Pad Entry', color: 'oklch(0.38 0.08 260)' },
            { id: crypto.randomUUID(), beat: 64, name: 'Build', color: 'oklch(0.38 0.12 320)' },
            { id: crypto.randomUUID(), beat: 96, name: 'Arp In', color: 'oklch(0.40 0.10 300)' },
            { id: crypto.randomUUID(), beat: 128, name: 'Drop A', color: 'oklch(0.42 0.15 30)' },
            { id: crypto.randomUUID(), beat: 192, name: 'Peak A', color: 'oklch(0.44 0.16 15)' },
            { id: crypto.randomUUID(), beat: 256, name: 'Breakdown', color: 'oklch(0.35 0.08 200)' },
            { id: crypto.randomUUID(), beat: 320, name: 'Drop B', color: 'oklch(0.42 0.15 10)' },
            { id: crypto.randomUUID(), beat: 384, name: 'Intensify', color: 'oklch(0.44 0.17 0)' },
            { id: crypto.randomUUID(), beat: 448, name: 'Chaos', color: 'oklch(0.45 0.18 50)' },
            { id: crypto.randomUUID(), beat: 512, name: 'Breakdown 2', color: 'oklch(0.35 0.08 180)' },
            { id: crypto.randomUUID(), beat: 576, name: 'Final Drop', color: 'oklch(0.42 0.15 0)' },
            { id: crypto.randomUUID(), beat: 672, name: 'Fade Out', color: 'oklch(0.35 0.08 260)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 64, name: 'Intro', color: 'oklch(0.35 0.10 280)' },
            { id: crypto.randomUUID(), startBeat: 64, endBeat: 128, name: 'Build', color: 'oklch(0.38 0.12 320)' },
            { id: crypto.randomUUID(), startBeat: 128, endBeat: 256, name: 'Drop A', color: 'oklch(0.42 0.15 30)' },
            { id: crypto.randomUUID(), startBeat: 256, endBeat: 320, name: 'Breakdown', color: 'oklch(0.35 0.08 200)' },
            { id: crypto.randomUUID(), startBeat: 320, endBeat: 448, name: 'Drop B', color: 'oklch(0.42 0.15 10)' },
            { id: crypto.randomUUID(), startBeat: 448, endBeat: 512, name: 'Chaos', color: 'oklch(0.45 0.18 50)' },
            {
                id: crypto.randomUUID(),
                startBeat: 512,
                endBeat: 576,
                name: 'Breakdown 2',
                color: 'oklch(0.35 0.08 180)',
            },
            { id: crypto.randomUUID(), startBeat: 576, endBeat: TB, name: 'Final Drop', color: 'oklch(0.42 0.15 0)' },
        ],
    });

    syncArrangement(tracks);

    const { ensureTrackStrips } = await import('#/modules/Transport/useCases/ensureTrackStrips');
    ensureTrackStrips();
    const { waitForDevices } = await import('#/modules/AudioEngine/useCases/engineAccess');
    await waitForDevices();

    projectStore.set({
        name: 'Psyloops (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
    });
}
