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

// ---------------------------------------------------------------------------
// Demo Project 3: Chill Jazz — "Midnight Smoke"
// Key: Eb major / C minor | BPM 82 | ~5:08 (588 beats)
// Structure: Intro(0-48) → A(48-132) → B(132-216) → Solo(216-300) →
//            Return A(300-384) → Variation(384-492) → Outro(492-588)
// 31 tracks across 7 folders
// ---------------------------------------------------------------------------
export async function demo3_AcousticSession(): Promise<void> {
    const bpm = 82;
    const TB = 588;

    const JAZZ_VOICINGS: number[][] = [
        [51, 55, 58, 62],
        [48, 51, 55, 58],
        [53, 56, 60, 63],
        [46, 50, 53, 56],
        [56, 60, 63, 67],
        [55, 58, 62, 65],
        [50, 53, 56, 60],
        [43, 47, 50, 53],
    ];
    const BASS_ROOTS = [39, 36, 41, 34, 44, 43, 38, 31];

    const PROG_A = [0, 2, 3, 0, 1, 5, 2, 3];
    const PROG_B = [4, 5, 2, 0, 1, 6, 7, 1];
    const PROG_SOLO = [2, 3, 0, 1, 4, 5, 6, 7];

    type Sec = { start: number; end: number; name: string; prog: number[] };
    const SECTIONS: Sec[] = [
        { start: 0, end: 48, name: 'Intro', prog: PROG_A },
        { start: 48, end: 132, name: 'A Theme', prog: PROG_A },
        { start: 132, end: 216, name: 'B Theme', prog: PROG_B },
        { start: 216, end: 300, name: 'Solo', prog: PROG_SOLO },
        { start: 300, end: 384, name: 'Return A', prog: PROG_A },
        { start: 384, end: 492, name: 'Variation', prog: PROG_B },
        { start: 492, end: 588, name: 'Outro', prog: PROG_A },
    ];
    const getSec = (b: number): Sec => SECTIONS.find((s) => b >= s.start && b < s.end) ?? SECTIONS[0]!;
    const getChordIdx = (b: number) => {
        const sec = getSec(b);
        return sec.prog[Math.floor((b - sec.start) / 8) % 8]!;
    };
    const hv = (base: number, r = 8) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));

    // ── TRACKS ───────────────────────────────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    // 🥁 Rhythm
    const rhythmFolder = createTrack({ name: '🥁 Rhythm', kind: 'folder' });
    const drumTrack = createTrack({ name: 'Jazz Drums', kind: 'midi', parentId: rhythmFolder.id });
    const percTrack = createTrack({ name: 'Percussion', kind: 'midi', parentId: rhythmFolder.id });
    const brushTrack = createTrack({ name: 'Brush Roll', kind: 'midi', parentId: rhythmFolder.id });

    // 🎸 Bass
    const bassFolder = createTrack({ name: '🎸 Bass', kind: 'folder' });
    const bassTrack = createTrack({ name: 'Walking Bass', kind: 'midi', parentId: bassFolder.id });
    const subTrack = createTrack({ name: 'Sub Layer', kind: 'midi', parentId: bassFolder.id });
    const arcoTrack = createTrack({ name: 'Arco Bass', kind: 'midi', parentId: bassFolder.id });

    // 🎹 Keys
    const keysFolder = createTrack({ name: '🎹 Keys', kind: 'folder' });
    const rhodesTrack = createTrack({ name: 'Rhodes', kind: 'midi', parentId: keysFolder.id });
    const organTrack = createTrack({ name: 'Organ', kind: 'midi', parentId: keysFolder.id });
    const pianoTrack = createTrack({ name: 'Piano Fill', kind: 'midi', parentId: keysFolder.id });

    // 🎺 Melody
    const melFolder = createTrack({ name: '🎺 Melody', kind: 'folder' });
    const fluteTrack = createTrack({ name: 'Flute', kind: 'midi', parentId: melFolder.id });
    const bellTrack = createTrack({ name: 'Bell Melody', kind: 'midi', parentId: melFolder.id });
    const melloTrack = createTrack({ name: 'Mellotron', kind: 'midi', parentId: melFolder.id });

    // 🎻 Strings & Pads
    const strFolder = createTrack({ name: '🎻 Strings & Pads', kind: 'folder' });
    const padTrack = createTrack({ name: 'Shimmer Pad', kind: 'midi', parentId: strFolder.id });
    const strSoftTrack = createTrack({ name: 'Soft Strings', kind: 'midi', parentId: strFolder.id });
    const strBrightTrack = createTrack({ name: 'Bright Strings', kind: 'midi', parentId: strFolder.id });
    const warmPadTrack = createTrack({ name: 'Warm Pad', kind: 'midi', parentId: strFolder.id });

    // ✨ Textures
    const texFolder = createTrack({ name: '✨ Textures', kind: 'folder' });
    const pluckATrack = createTrack({ name: 'Pluck A', kind: 'midi', parentId: texFolder.id });
    const pluckBTrack = createTrack({ name: 'Pluck B', kind: 'midi', parentId: texFolder.id });
    const bellAccTrack = createTrack({ name: 'Bell Accent', kind: 'midi', parentId: texFolder.id });
    const marimbaTrack = createTrack({ name: 'Marimba Tap', kind: 'midi', parentId: texFolder.id });
    const glassTrack = createTrack({ name: 'Glass Swell', kind: 'midi', parentId: texFolder.id });

    // 🌊 Deep
    const deepFolder = createTrack({ name: '🌊 Deep', kind: 'folder' });
    const droneTrack = createTrack({ name: 'Deep Drone', kind: 'midi', parentId: deepFolder.id });
    const shimmerTrack = createTrack({ name: 'Shimmer Wash', kind: 'midi', parentId: deepFolder.id });
    const crystalTrack = createTrack({ name: 'Crystal Arp', kind: 'midi', parentId: deepFolder.id });
    const reverbBus = createTrack({ name: 'Reverb Bus', kind: 'bus' });

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
    percTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    brushTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 1 },
        },
    ];
    applyPreset(bassTrack, 'factory-bass-analog');
    applyPreset(subTrack, 'factory-bass-sub');
    applyPreset(arcoTrack, 'factory-strings-soft');
    applyPreset(rhodesTrack, 'factory-faust-rhodes-ambient');
    applyPreset(organTrack, 'factory-faust-hammond-ballad');
    applyPreset(pianoTrack, 'factory-keys-bell');
    applyPreset(fluteTrack, 'factory-synth-flute');
    applyPreset(bellTrack, 'factory-keys-bell');
    applyPreset(melloTrack, 'factory-strings-soft');
    applyPreset(padTrack, 'factory-faust-fm-pad');
    applyPreset(strSoftTrack, 'factory-strings-soft');
    applyPreset(strBrightTrack, 'factory-strings-bright');
    applyPreset(warmPadTrack, 'factory-pad-warm');
    applyPreset(pluckATrack, 'factory-keys-pluck');
    applyPreset(pluckBTrack, 'factory-keys-pluck');
    applyPreset(bellAccTrack, 'factory-faust-fm-dx-bells');
    applyPreset(marimbaTrack, 'factory-keys-marimba');
    applyPreset(glassTrack, 'factory-faust-additive-glass');
    applyPreset(droneTrack, 'factory-pad-dark');
    applyPreset(shimmerTrack, 'factory-faust-supersaw-pad');
    applyPreset(crystalTrack, 'factory-faust-additive-glass');

    // ── FX HELPER ────────────────────────────────────────────────────────────
    const addDev = (t: any, type: string, name: string, params: Record<string, number>) => {
        t.devices = [
            ...(t.devices ?? []),
            { id: `dev-${crypto.randomUUID()}`, name, type, bypassed: false, parameterValues: params },
        ];
    };

    // Master chain
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 1.5,
        'eq-low-freq': 80,
        'eq-low-q': 0.8,
        'eq-mid-gain': -1,
        'eq-mid-freq': 400,
        'eq-mid-q': 1.2,
        'eq-high-gain': 1.8,
        'eq-high-freq': 10000,
        'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -12,
        'comp-ratio': 2,
        'comp-attack': 35,
        'comp-release': 250,
        'comp-knee': 12,
        'comp-makeup': 1.5,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.1,
        'width-mid': 0,
        'width-side': 1.3,
        'width-mono-bass': 200,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -1 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -16 });

    // Reverb bus
    addDev(reverbBus, 'builtin-convolution-reverb', 'Room IR', {
        'conv-ir': 6,
        'conv-mix': 0.5,
        'conv-predelay': 30,
        'conv-lowcut': 80,
        'conv-highcut': 10000,
    });

    // Per-track
    addDev(rhodesTrack, 'builtin-chorus', 'Rhodes Shimmer', {
        'chorus-rate': 0.3,
        'chorus-depth': 4,
        'chorus-feedback': 0.12,
        'chorus-mix': 0.25,
    });
    addDev(rhodesTrack, 'builtin-delay', 'Rhodes Echo', {
        'delay-time': 366,
        'delay-feedback': 0.22,
        'delay-mix': 0.16,
    });
    addDev(rhodesTrack, 'builtin-reverb', 'Rhodes Space', {
        'rev-size': 0.7,
        'rev-decay': 3,
        'rev-damping': 0.25,
        'rev-mix': 0.2,
    });
    addDev(organTrack, 'builtin-tremolo', 'Leslie Trem', { 'trem-rate': 5, 'trem-depth': 0.35, 'trem-shape': 0 });
    addDev(organTrack, 'builtin-reverb', 'Organ Hall', {
        'rev-size': 0.6,
        'rev-decay': 2,
        'rev-damping': 0.3,
        'rev-mix': 0.18,
    });
    addDev(pianoTrack, 'builtin-convolution-reverb', 'Piano Room', {
        'conv-ir': 0,
        'conv-mix': 0.25,
        'conv-predelay': 10,
        'conv-lowcut': 100,
        'conv-highcut': 12000,
    });
    addDev(fluteTrack, 'builtin-delay', 'Flute Echo', { 'delay-time': 293, 'delay-feedback': 0.3, 'delay-mix': 0.2 });
    addDev(fluteTrack, 'builtin-reverb', 'Flute Space', {
        'rev-size': 0.7,
        'rev-decay': 3,
        'rev-damping': 0.25,
        'rev-mix': 0.28,
    });
    addDev(bellTrack, 'builtin-convolution-reverb', 'Bell Room', {
        'conv-ir': 2,
        'conv-mix': 0.3,
        'conv-predelay': 15,
        'conv-lowcut': 200,
        'conv-highcut': 12000,
    });
    addDev(melloTrack, 'builtin-reverb', 'Mello Hall', {
        'rev-size': 0.8,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.3,
    });
    addDev(melloTrack, 'builtin-chorus', 'Mello Chorus', { 'chorus-rate': 0.2, 'chorus-depth': 5, 'chorus-mix': 0.2 });
    addDev(padTrack, 'builtin-reverb', 'Pad Hall', {
        'rev-size': 0.9,
        'rev-decay': 6,
        'rev-damping': 0.15,
        'rev-mix': 0.35,
    });
    addDev(strSoftTrack, 'builtin-reverb', 'Strings Hall', {
        'rev-size': 0.85,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.3,
    });
    addDev(strBrightTrack, 'builtin-reverb', 'Bright Hall', {
        'rev-size': 0.7,
        'rev-decay': 2.5,
        'rev-damping': 0.25,
        'rev-mix': 0.25,
    });
    addDev(strBrightTrack, 'builtin-chorus', 'Bright Chorus', {
        'chorus-rate': 0.25,
        'chorus-depth': 5,
        'chorus-mix': 0.2,
    });
    addDev(warmPadTrack, 'builtin-flanger', 'Pad Flange', {
        'flanger-rate': 0.05,
        'flanger-depth': 5,
        'flanger-feedback': 0.3,
        'flanger-mix': 0.18,
    });
    addDev(warmPadTrack, 'builtin-reverb', 'Warm Hall', {
        'rev-size': 0.95,
        'rev-decay': 7,
        'rev-damping': 0.1,
        'rev-mix': 0.25,
    });
    addDev(bassTrack, 'builtin-eq', 'Bass EQ', {
        'eq-low-gain': 2,
        'eq-low-freq': 80,
        'eq-low-q': 1,
        'eq-mid-gain': -1,
        'eq-mid-freq': 500,
        'eq-mid-q': 1.2,
        'eq-high-gain': 0.5,
        'eq-high-freq': 5000,
        'eq-high-q': 0.8,
    });
    addDev(arcoTrack, 'builtin-reverb', 'Arco Hall', {
        'rev-size': 0.75,
        'rev-decay': 3.5,
        'rev-damping': 0.2,
        'rev-mix': 0.25,
    });
    addDev(glassTrack, 'builtin-reverb', 'Glass Verb', {
        'rev-size': 0.95,
        'rev-decay': 7,
        'rev-damping': 0.08,
        'rev-mix': 0.45,
    });
    addDev(glassTrack, 'builtin-chorus', 'Glass Shimmer', {
        'chorus-rate': 0.15,
        'chorus-depth': 12,
        'chorus-mix': 0.35,
    });
    addDev(bellAccTrack, 'builtin-delay', 'Bell Delay', {
        'delay-time': 488,
        'delay-feedback': 0.38,
        'delay-mix': 0.28,
    });
    addDev(pluckATrack, 'builtin-delay', 'Pluck A Delay', {
        'delay-time': 244,
        'delay-feedback': 0.38,
        'delay-mix': 0.28,
    });
    addDev(pluckBTrack, 'builtin-delay', 'Pluck B Delay', {
        'delay-time': 366,
        'delay-feedback': 0.4,
        'delay-mix': 0.3,
    });
    addDev(crystalTrack, 'builtin-delay', 'Crystal Delay', {
        'delay-time': 183,
        'delay-feedback': 0.5,
        'delay-mix': 0.35,
    });
    addDev(crystalTrack, 'builtin-autopan', 'Crystal Pan', { 'autopan-rate': 0.3, 'autopan-depth': 0.55 });
    addDev(droneTrack, 'builtin-reverb', 'Drone Verb', {
        'rev-size': 1.0,
        'rev-decay': 14,
        'rev-damping': 0.04,
        'rev-mix': 0.65,
    });
    addDev(shimmerTrack, 'builtin-chorus', 'Shim Chorus', {
        'chorus-rate': 0.08,
        'chorus-depth': 16,
        'chorus-feedback': 0.25,
        'chorus-mix': 0.5,
    });
    addDev(shimmerTrack, 'builtin-reverb', 'Shim Verb', {
        'rev-size': 0.95,
        'rev-decay': 8,
        'rev-damping': 0.08,
        'rev-mix': 0.5,
    });
    addDev(drumTrack, 'builtin-eq', 'Drum EQ', {
        'eq-low-gain': 2,
        'eq-low-freq': 60,
        'eq-low-q': 1,
        'eq-mid-gain': -1.5,
        'eq-mid-freq': 350,
        'eq-mid-q': 1.5,
        'eq-high-gain': 1,
        'eq-high-freq': 8000,
        'eq-high-q': 0.8,
    });

    // ── GAIN / PAN ───────────────────────────────────────────────────────────
    drumTrack.gain = 0.6;
    drumTrack.pan = 0;
    percTrack.gain = 0.4;
    percTrack.pan = 18;
    brushTrack.gain = 0.25;
    brushTrack.pan = -12;
    bassTrack.gain = 0.65;
    bassTrack.pan = 0;
    subTrack.gain = 0.4;
    subTrack.pan = 0;
    arcoTrack.gain = 0.3;
    arcoTrack.pan = -20;
    rhodesTrack.gain = 0.55;
    rhodesTrack.pan = -18;
    organTrack.gain = 0.35;
    organTrack.pan = 15;
    pianoTrack.gain = 0.45;
    pianoTrack.pan = 10;
    fluteTrack.gain = 0.5;
    fluteTrack.pan = -25;
    bellTrack.gain = 0.45;
    bellTrack.pan = 22;
    melloTrack.gain = 0.4;
    melloTrack.pan = -8;
    padTrack.gain = 0.35;
    padTrack.pan = 0;
    strSoftTrack.gain = 0.45;
    strSoftTrack.pan = -30;
    strBrightTrack.gain = 0.4;
    strBrightTrack.pan = 30;
    warmPadTrack.gain = 0.3;
    warmPadTrack.pan = 12;
    pluckATrack.gain = 0.15;
    pluckATrack.pan = -38;
    pluckBTrack.gain = 0.12;
    pluckBTrack.pan = 38;
    bellAccTrack.gain = 0.12;
    bellAccTrack.pan = 45;
    marimbaTrack.gain = 0.18;
    marimbaTrack.pan = -20;
    glassTrack.gain = 0.15;
    glassTrack.pan = 28;
    droneTrack.gain = 0.2;
    droneTrack.pan = 0;
    shimmerTrack.gain = 0.18;
    shimmerTrack.pan = -15;
    crystalTrack.gain = 0.15;
    crystalTrack.pan = 35;

    // ── CLIPS ────────────────────────────────────────────────────────────────
    const mkC = (t: any, name: string, s: number, e: number, fi = 0, fo = 0) => {
        const c = createMidiClip(t.id, name, s, e, t.color);
        c.fadeInBeats = fi;
        c.fadeOutBeats = fo;
        t.clips = [...(t.clips ?? []), c];
        return c;
    };

    const dk1 = mkC(drumTrack, 'Intro Beat', 0, 48, 2);
    const dk2 = mkC(drumTrack, 'A Theme', 48, 216);
    const dk3 = mkC(drumTrack, 'Solo Drive', 216, 384);
    const dk4 = mkC(drumTrack, 'Variation Peak', 384, 492);
    const dk5 = mkC(drumTrack, 'Outro Fade', 492, TB, 0, 12);
    const percC = mkC(percTrack, 'Latin Perc', 48, TB);
    const brushC = mkC(brushTrack, 'Brush Roll', 0, TB, 4);
    const bassC = mkC(bassTrack, 'Walking Bass', 0, TB);
    const subC = mkC(subTrack, 'Sub Root', 0, TB);
    const arcoC = mkC(arcoTrack, 'Arco Pad', 132, 492);
    const rhodC = mkC(rhodesTrack, 'Rhodes Comp', 0, TB);
    const orgC = mkC(organTrack, 'Organ Swells', 132, 384);
    const pianoC = mkC(pianoTrack, 'Piano Fills', 216, 492);
    const fluteC = mkC(fluteTrack, 'Flute Solo', 216, 384, 4);
    const bellC = mkC(bellTrack, 'Bell Melody', 48, 300);
    const melloC = mkC(melloTrack, 'Mello Theme', 132, TB, 8);
    const padC = mkC(padTrack, 'Shimmer', 0, TB, 8);
    const strSC = mkC(strSoftTrack, 'Soft Strings', 132, TB);
    const strBC = mkC(strBrightTrack, 'Bright Str', 384, 492);
    const warmC = mkC(warmPadTrack, 'Warm Pad', 0, TB, 4);
    const plkAC = mkC(pluckATrack, 'Pluck A', 48, TB);
    const plkBC = mkC(pluckBTrack, 'Pluck B', 48, TB);
    const bellAC = mkC(bellAccTrack, 'Bell Acc', 48, TB);
    const marC = mkC(marimbaTrack, 'Marimba', 132, 492);
    const glasC = mkC(glassTrack, 'Glass', 0, TB, 8, 8);
    const droC = mkC(droneTrack, 'Drone', 0, TB);
    const shimC = mkC(shimmerTrack, 'Shimmer Wash', 0, TB, 16);
    const crystC = mkC(crystalTrack, 'Crystal', 132, 492);

    // ── NOTE GENERATION ──────────────────────────────────────────────────────
    const dn: MidiNote[] = []; // drums
    const pcn: MidiNote[] = []; // perc
    const brn: MidiNote[] = []; // brush
    const bn: MidiNote[] = []; // bass
    const sbn: MidiNote[] = []; // sub
    const arcn: MidiNote[] = []; // arco
    const rn: MidiNote[] = []; // rhodes
    const on: MidiNote[] = []; // organ
    const pin: MidiNote[] = []; // piano
    const fn: MidiNote[] = []; // flute
    const bln: MidiNote[] = []; // bell melody
    const meln: MidiNote[] = []; // mellotron
    const pdn: MidiNote[] = []; // pad
    const strn: MidiNote[] = []; // soft strings
    const stbn: MidiNote[] = []; // bright strings
    const wpn: MidiNote[] = []; // warm pad
    const plkAN: MidiNote[] = []; // pluck A
    const plkBN: MidiNote[] = []; // pluck B
    const blaAN: MidiNote[] = []; // bell accent
    const marn: MidiNote[] = []; // marimba
    const glan: MidiNote[] = []; // glass
    const dron: MidiNote[] = []; // drone
    const shwn: MidiNote[] = []; // shimmer
    const cryn: MidiNote[] = []; // crystal

    // Jazz drums (swing 8ths)
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) {
            break;
        }
        const p = b % 4;
        const sec = getSec(b);
        const isIntro = sec.name === 'Intro';
        const isOutro = sec.name === 'Outro';
        const bar = Math.floor(b / 4);

        if (p % 1 === 0) {
            dn.push(note(42, b, 0.3, hv(isIntro ? 40 : 65)));
        }
        if (p % 1 === 0.75) {
            dn.push(note(42, b, 0.2, hv(isIntro ? 28 : 42)));
        } // swing offbeat
        if ((p === 1 || p === 3) && !isIntro) {
            dn.push(note(37, b, 0.2, hv(isOutro ? 38 : 65)));
        }
        if (!isIntro && p === 0 && bar % 2 === 0) {
            dn.push(note(36, b, 0.4, hv(72)));
        }
        if (!isIntro && p === 2.5 && bar % 2 === 1) {
            dn.push(note(36, b, 0.3, hv(55)));
        }
        if (!isIntro && !isOutro && p % 0.25 === 0 && Math.random() < 0.07) {
            dn.push(note(38, b, 0.1, hv(24, 5)));
        }

        // Brush roll — persistent swirl
        if (p % 0.5 === 0) {
            brn.push(note(37, b, 0.2, hv(isIntro ? 25 : 32)));
        }
        if (bar % 4 === 3 && p === 3) {
            brn.push(note(46, b, 0.5, hv(28)));
        } // open hat swell

        // Perc
        if (b >= 48) {
            const claveBar = bar % 2;
            if (claveBar === 0) {
                pcn.push(note(75, b * 1 + 0, 0.1, hv(40)));
                pcn.push(note(75, b + 1.5, 0.1, hv(35)));
                pcn.push(note(75, b + 3, 0.1, hv(38)));
            } else {
                pcn.push(note(75, b + 1, 0.1, hv(35)));
                pcn.push(note(75, b + 2, 0.1, hv(40)));
            }
            if ((sec.name === 'Variation' || sec.name === 'Solo') && p === 0.75) {
                pcn.push(note(62, b, 0.15, hv(45)));
            }
            if ((sec.name === 'Variation' || sec.name === 'Solo') && p === 2.25) {
                pcn.push(note(63, b, 0.15, hv(40)));
            }
        }
    }

    // Walking bass + sub
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) {
            break;
        }
        const ci0 = getChordIdx(bs);
        const ci1 = getChordIdx(Math.min(bs + 4, TB - 1));
        const root = BASS_ROOTS[ci0]!;
        const nextRoot = BASS_ROOTS[ci1]!;
        const voicing = JAZZ_VOICINGS[ci0]!;
        const sec = getSec(bs);
        const v = sec.name === 'Intro' ? 62 : sec.name === 'Outro' ? 52 : 80;
        bn.push(note(root, bs, 0.9, hv(v)));
        bn.push(note(voicing[Math.floor(Math.random() * 2) + 1]! - 12, bs + 1, 0.9, hv(v - 5)));
        bn.push(note(root + (nextRoot > root ? 4 : -3), bs + 2, 0.9, hv(v - 8)));
        bn.push(note(nextRoot > root ? nextRoot - 1 : nextRoot + 1, bs + 3, 0.9, hv(v - 3)));
        sbn.push(note(root - 12, bs, 3.8, hv(68)));
    }

    // Arco bass (legato roots from B theme onward)
    for (let b = 132; b < 492; b += 16) {
        const ci0 = getChordIdx(b);
        const root = BASS_ROOTS[ci0]!;
        arcn.push(note(root - 12, b, 15.5, hv(45)));
        arcn.push(note(root, b + 8, 7.5, hv(38)));
    }

    // Rhodes comping
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) {
            break;
        }
        const v = JAZZ_VOICINGS[getChordIdx(bs)]!;
        const sec = getSec(bs);
        const vel = sec.name === 'Intro' ? 52 : sec.name === 'Outro' ? 42 : 68;
        const patIdx = bar % 4;
        if (patIdx === 0) {
            for (const t of v) {
                rn.push(note(t, bs + 0.1, 1.5, hv(vel)));
            }
            for (const t of v) {
                rn.push(note(t, bs + 2.75, 0.8, hv(vel - 10)));
            }
        } else if (patIdx === 1) {
            for (const t of v) {
                rn.push(note(t, bs + 1, 1, hv(vel)));
            }
            for (const t of v) {
                rn.push(note(t, bs + 3.5, 0.4, hv(vel - 15)));
            }
        } else if (patIdx === 2) {
            for (const t of v) {
                rn.push(note(t, bs + 0.15, 3.5, hv(vel - 5)));
            }
        } else {
            for (const t of v) {
                rn.push(note(t, bs, 0.5, hv(vel)));
            }
            for (const t of v) {
                rn.push(note(t, bs + 1.5, 0.5, hv(vel - 8)));
            }
            for (const t of v) {
                rn.push(note(t, bs + 3, 0.8, hv(vel - 5)));
            }
        }
    }

    // Organ swells (B theme / Return A)
    for (let b = 132; b < 384; b += 8) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        for (const t of v) {
            on.push(note(t - 12, b, 7.5, hv(48)));
        }
    }

    // Piano fills (solo + variation)
    const pianoFills: [number, number, number, number][] = [
        [0, 70, 0.5, 70],
        [0.5, 72, 0.5, 68],
        [1, 74, 1, 72],
        [2.5, 72, 0.5, 65],
        [3, 70, 1, 68],
        [4, 69, 1, 72],
        [5.5, 70, 0.5, 68],
        [6, 72, 1, 70],
        [7.5, 74, 0.5, 65],
    ];
    for (let b = 216; b < 492; b += 8) {
        if (b >= 300 && b < 384 && b % 16 !== 0) {
            continue;
        } // sparse in Return A
        for (const [off, pitch, dur, vel] of pianoFills) {
            pin.push(note(pitch, b + off, dur, hv(vel)));
        }
    }

    // Bell melody (A and B themes)
    const melA: [number, number, number, number][] = [
        [0, 67, 1.5, 74],
        [2, 65, 1, 70],
        [3, 63, 0.75, 72],
        [4, 62, 2, 68],
        [6, 63, 1, 65],
        [7, 65, 1, 70],
    ];
    const melB: [number, number, number, number][] = [
        [0, 70, 2, 72],
        [2, 72, 1, 68],
        [3.5, 70, 0.5, 65],
        [4, 67, 1.5, 70],
        [6, 65, 1, 68],
        [7.5, 67, 0.5, 60],
    ];
    for (let phrase = 0; phrase < (300 - 48) / 8; phrase++) {
        const start = 48 + phrase * 8;
        const sec = getSec(start);
        if (sec.name === 'Solo') {
            continue;
        }
        const mel = phrase % 2 === 0 ? melA : melB;
        const tr = sec.name === 'B Theme' ? 2 : 0;
        for (const [off, pitch, dur, vel] of mel) {
            bln.push(note(pitch + tr, start + off, dur, hv(vel)));
        }
    }

    // Flute solo
    const flPhrases: [number, number, number, number][][] = [
        [
            [0, 72, 1, 75],
            [1.5, 74, 0.5, 70],
            [2, 75, 2, 72],
            [4, 77, 1.5, 68],
            [6, 75, 1, 65],
            [7, 72, 1, 70],
        ],
        [
            [0, 79, 0.75, 72],
            [1, 77, 0.75, 70],
            [2, 75, 1.5, 68],
            [4, 72, 2, 72],
            [6.5, 74, 1, 65],
            [7.5, 75, 0.5, 60],
        ],
        [
            [0, 70, 2, 70],
            [2.5, 72, 1, 68],
            [4, 74, 1.5, 72],
            [6, 77, 1, 65],
            [7, 75, 1, 70],
        ],
        [
            [0, 75, 1, 68],
            [1.5, 77, 0.5, 65],
            [2, 79, 2, 72],
            [4.5, 77, 1.5, 68],
            [6, 75, 1, 70],
            [7, 72, 1, 65],
        ],
    ];
    for (let ph = 0; ph < (384 - 216) / 8; ph++) {
        const start = 216 + ph * 8;
        for (const [off, pitch, dur, vel] of flPhrases[ph % flPhrases.length]!) {
            fn.push(note(pitch, start + off, dur, hv(vel)));
        }
    }

    // Mellotron (entry at B theme, lyrical answer)
    const melloMel: [number, number, number, number][] = [
        [0, 62, 2, 58],
        [2.5, 65, 1.5, 55],
        [4, 67, 2, 62],
        [6.5, 65, 1.5, 52],
    ];
    for (let b = 132; b < TB; b += 8) {
        const sec = getSec(b);
        if (sec.name === 'Intro') {
            continue;
        }
        const tr = sec.name === 'Variation' ? -2 : sec.name === 'Outro' ? -5 : 0;
        for (const [off, pitch, dur, vel] of melloMel) {
            meln.push(note(pitch + tr, b + off, dur, hv(vel)));
        }
    }

    // Pads / Strings
    for (let b = 0; b < TB; b += 16) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        const sec = getSec(b);
        const vel = sec.name === 'Intro' || sec.name === 'Outro' ? 32 : 48;
        for (const t of v) {
            pdn.push(note(t + 12, b, 15.8, hv(vel)));
        }
    }
    for (let b = 132; b < TB; b += 16) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        const sec = getSec(b);
        for (const t of v) {
            strn.push(note(t, b, 15.8, hv(sec.name === 'Outro' ? 28 : 44)));
        }
    }
    for (let b = 384; b < 492; b += 8) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        for (const t of v) {
            stbn.push(note(t + 12, b, 7.5, hv(60)));
        }
    }
    for (let b = 0; b < TB; b += 16) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        const sec = getSec(b);
        for (const t of v.slice(0, 3)) {
            wpn.push(note(t, b, 15.5, hv(sec.name === 'Intro' ? 30 : 40)));
        }
    }

    // Textures
    for (let b = 48; b < TB; b += 32) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        plkAN.push(note(v[0]! + 12, b - 0.5, 0.2, hv(55)));
        plkAN.push(note(v[2]! + 12, b, 0.5, hv(65)));
    }
    for (let b = 48; b < TB; b += 32) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        plkBN.push(note(v[3]! + 24, b + 15.5, 0.2, hv(52)));
        plkBN.push(note(v[1]! + 24, b + 16, 0.5, hv(62)));
    }
    for (let b = 48; b < TB; b += 8) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        blaAN.push(note(v[3]! + 24, b + 2, 2, hv(32)));
    }
    for (let b = 132; b < 492; b += 4) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        marn.push(note(v[b % 4 === 0 ? 0 : b % 4 === 2 ? 2 : 1]! + 12, b, 0.15, hv(42)));
    }
    for (let b = 0; b < TB; b += 32) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        for (const t of v) {
            glan.push(note(t + 24, b, 31, hv(28)));
        }
    }
    for (let b = 0; b < TB; b += 32) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        for (const t of v.slice(0, 3)) {
            dron.push(note(t - 12, b, 31, hv(22)));
        }
    }
    for (let b = 0; b < TB; b += 16) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        for (const t of v) {
            shwn.push(note(t + 12, b, 15.8, hv(27)));
        }
    }
    for (let b = 132; b < 492; b += 0.5) {
        const v = JAZZ_VOICINGS[getChordIdx(b)]!;
        cryn.push(note(v[Math.floor(b * 2) % v.length]! + 12, b, 0.25, hv(35)));
    }

    // ── ASSEMBLE ─────────────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        rhythmFolder,
        drumTrack,
        percTrack,
        brushTrack,
        bassFolder,
        bassTrack,
        subTrack,
        arcoTrack,
        keysFolder,
        rhodesTrack,
        organTrack,
        pianoTrack,
        melFolder,
        fluteTrack,
        bellTrack,
        melloTrack,
        strFolder,
        padTrack,
        strSoftTrack,
        strBrightTrack,
        warmPadTrack,
        texFolder,
        pluckATrack,
        pluckBTrack,
        bellAccTrack,
        marimbaTrack,
        glassTrack,
        deepFolder,
        droneTrack,
        shimmerTrack,
        crystalTrack,
        reverbBus,
    ];
    trackStore.set({ tracks, selectedTrackId: rhodesTrack.id });

    const rel = (notes: MidiNote[], start: number) => notes.map((n) => ({ ...n, startBeat: n.startBeat - start }));
    const flt = (notes: MidiNote[], lo: number, hi: number) =>
        notes.filter((n) => n.startBeat >= lo && n.startBeat < hi);

    midiStore.set({
        notesByClipId: {
            [dk1.id]: rel(flt(dn, 0, 48), 0),
            [dk2.id]: rel(flt(dn, 48, 216), 48),
            [dk3.id]: rel(flt(dn, 216, 384), 216),
            [dk4.id]: rel(flt(dn, 384, 492), 384),
            [dk5.id]: rel(flt(dn, 492, TB), 492),
            [percC.id]: rel(pcn, 48),
            [brushC.id]: brn,
            [bassC.id]: bn,
            [subC.id]: sbn,
            [arcoC.id]: rel(arcn, 132),
            [rhodC.id]: rn,
            [orgC.id]: rel(on, 132),
            [pianoC.id]: rel(flt(pin, 216, 492), 216),
            [fluteC.id]: rel(flt(fn, 216, 384), 216),
            [bellC.id]: rel(flt(bln, 48, 300), 48),
            [melloC.id]: rel(flt(meln, 132, TB), 132),
            [padC.id]: pdn,
            [strSC.id]: rel(flt(strn, 132, TB), 132),
            [strBC.id]: rel(flt(stbn, 384, 492), 384),
            [warmC.id]: wpn,
            [plkAC.id]: rel(plkAN, 48),
            [plkBC.id]: rel(plkBN, 48),
            [bellAC.id]: rel(blaAN, 48),
            [marC.id]: rel(flt(marn, 132, 492), 132),
            [glasC.id]: glan,
            [droC.id]: dron,
            [shimC.id]: shwn,
            [crystC.id]: rel(flt(cryn, 132, 492), 132),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION ───────────────────────────────────────────────────────────
    const mkL = (id: string, p: string, l: string, mn: number, mx: number) => createAutomationLane(id, p, l, mn, mx);

    const rhodVol = mkL(rhodesTrack.id, 'volume', 'Volume', 0, 1);
    rhodVol.points = [
        { beat: 0, value: 0.38, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.68, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.68, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const strSVol = mkL(strSoftTrack.id, 'volume', 'Volume', 0, 1);
    strSVol.points = [
        { beat: 132, value: 0, curve: 'linear', tension: 0 },
        { beat: 164, value: 0.48, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.52, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.85, curve: 'linear', tension: 0 },
    ];

    const padVol = mkL(padTrack.id, 'volume', 'Volume', 0, 1);
    padVol.points = [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.48, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 555, value: 0.85, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
    ];

    const fluteVol = mkL(fluteTrack.id, 'volume', 'Volume', 0, 1);
    fluteVol.points = [
        { beat: 216, value: 0, curve: 'linear', tension: 0 },
        { beat: 228, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 376, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 384, value: 0, curve: 'linear', tension: 0 },
    ];

    const warmVol = mkL(warmPadTrack.id, 'volume', 'Volume', 0, 1);
    warmVol.points = [
        { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 132, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.55, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.85, curve: 'linear', tension: 0 },
    ];

    const drumsVol = mkL(drumTrack.id, 'volume', 'Volume', 0, 1);
    drumsVol.points = [
        { beat: 0, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.62, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.78, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.62, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.15, curve: 'linear', tension: 0 },
    ];

    const melloVol = mkL(melloTrack.id, 'volume', 'Volume', 0, 1);
    melloVol.points = [
        { beat: 132, value: 0, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.42, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.52, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.42, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.6, curve: 'linear', tension: 0 },
    ];

    const droneVol = mkL(droneTrack.id, 'volume', 'Volume', 0, 1);
    droneVol.points = [
        { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 132, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.6, curve: 'linear', tension: 0 },
    ];

    const shimVol = mkL(shimmerTrack.id, 'volume', 'Volume', 0, 1);
    shimVol.points = [
        { beat: 0, value: 0.22, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.32, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.42, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.65, curve: 'linear', tension: 0 },
    ];

    // Dramatic FX
    const rhodRevMix = mkL(rhodesTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    rhodRevMix.points = [
        { beat: 0, value: 0.08, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.28, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.22, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
    ];

    const warmRevMix = mkL(warmPadTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    warmRevMix.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 132, value: 0.18, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.35, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.65, curve: 'linear', tension: 0 },
    ];

    const glassRevMix = mkL(glassTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    glassRevMix.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.6, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.8, curve: 'linear', tension: 0 },
    ];

    const strBVol = mkL(strBrightTrack.id, 'volume', 'Volume', 0, 1);
    strBVol.points = [
        { beat: 384, value: 0, curve: 'linear', tension: 0 },
        { beat: 404, value: 0.78, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 492, value: 0, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            rhodVol,
            strSVol,
            padVol,
            fluteVol,
            warmVol,
            drumsVol,
            melloVol,
            droneVol,
            shimVol,
            rhodRevMix,
            warmRevMix,
            glassRevMix,
            strBVol,
        ],
    });

    // ── MARKERS / SECTIONS ───────────────────────────────────────────────────
    markerStore.set({
        markers: SECTIONS.map((s) => ({
            id: crypto.randomUUID(),
            beat: s.start,
            name: s.name,
            color: 'oklch(0.38 0.07 220)',
        })),
        sections: SECTIONS.map((s) => ({
            id: crypto.randomUUID(),
            startBeat: s.start,
            endBeat: s.end,
            name: s.name,
            color: s.name.includes('A')
                ? 'oklch(0.38 0.08 200)'
                : s.name.includes('B')
                  ? 'oklch(0.38 0.08 160)'
                  : s.name === 'Solo'
                    ? 'oklch(0.40 0.10 40)'
                    : s.name === 'Variation'
                      ? 'oklch(0.40 0.09 120)'
                      : 'oklch(0.36 0.06 240)',
        })),
    });

    syncArrangement(tracks);

    const { ensureTrackStrips } = await import('#/modules/Transport/useCases/ensureTrackStrips');
    ensureTrackStrips();
    const { waitForDevices } = await import('#/modules/AudioEngine/useCases/engineAccess');
    await waitForDevices();

    projectStore.set({
        name: 'Midnight Smoke (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
    });
}
