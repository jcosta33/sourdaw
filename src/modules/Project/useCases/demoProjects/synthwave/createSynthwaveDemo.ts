import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI';
import { projectStore } from '../../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { automationStore, createAutomationLane } from '#/modules/Automation';
import type { MidiNote } from '../../../models/DemoProjectTypes';
import { note, applyPreset, createMidiClip, syncArrangement } from '../demoUtils';
export async function demo4_NativeShowcase(): Promise<void> {
    const bpm = 83;
    const TB = 816;

    // Eb minor / Gb major: Eb F Gb Ab Bb Cb Db
    // Chord pool (MIDI voicings in octave 3-4)
    const CHORDS: Record<string, number[]> = {
        Ebm7: [51, 54, 58, 62], // Eb3 Gb3 Bb3 Db4
        Gbmaj7: [54, 58, 61, 65], // Gb3 Bb3 Db4 F4
        Abm7: [56, 59, 63, 66], // Ab3 Cb4 Eb4 Gb4
        Bb7: [58, 62, 65, 68], // Bb3 D4  F4  Ab4
        Dbmaj7: [49, 53, 56, 60], // Db3 F3  Ab3 C4
        Cbmaj7: [47, 51, 54, 58], // Cb3 Eb3 Gb3 Bb3
        Fm7b5: [53, 56, 59, 63], // F3  Ab3 Cb4 Eb4
        Ebm9: [51, 54, 58, 62, 66], // Eb3 Gb3 Bb3 Db4 F4
    };
    const BASS: Record<string, number> = {
        Ebm7: 39,
        Gbmaj7: 42,
        Abm7: 44,
        Bb7: 46,
        Dbmaj7: 37,
        Cbmaj7: 35,
        Fm7b5: 41,
        Ebm9: 39,
    };

    // Section chord progressions (chord name per 8-beat block)
    const PROG_MAIN = ['Ebm7', 'Gbmaj7', 'Abm7', 'Bb7', 'Dbmaj7', 'Abm7', 'Fm7b5', 'Ebm7'];
    const PROG_WARP = ['Ebm9', 'Cbmaj7', 'Gbmaj7', 'Abm7', 'Fm7b5', 'Bb7', 'Dbmaj7', 'Ebm9'];
    const PROG_HYPER = ['Abm7', 'Bb7', 'Ebm7', 'Gbmaj7', 'Dbmaj7', 'Fm7b5', 'Cbmaj7', 'Abm7'];

    type Sec = { start: number; end: number; name: string; prog: string[] };
    const SECTIONS: Sec[] = [
        { start: 0, end: 64, name: 'Fog', prog: PROG_MAIN },
        { start: 64, end: 160, name: 'Fracture', prog: PROG_MAIN },
        { start: 160, end: 288, name: 'Gravity', prog: PROG_MAIN },
        { start: 288, end: 384, name: 'Warp', prog: PROG_WARP },
        { start: 384, end: 480, name: 'Collapse', prog: PROG_WARP },
        { start: 480, end: 576, name: 'Nebula', prog: PROG_HYPER },
        { start: 576, end: 720, name: 'Hyperspace', prog: PROG_HYPER },
        { start: 720, end: 816, name: 'Dust', prog: PROG_MAIN },
    ];
    const getSec = (b: number): Sec => SECTIONS.find((s) => b >= s.start && b < s.end) ?? SECTIONS[0]!;
    const getChord = (b: number): string => {
        const sec = getSec(b);
        const idx = Math.floor((b - sec.start) / 8) % sec.prog.length;
        return sec.prog[idx]!;
    };
    const cv = (b: number) => CHORDS[getChord(b)]!;
    const broot = (b: number) => BASS[getChord(b)]!;
    const hv = (base: number, r = 8) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));
    const R = (b: number, lo: number, hi: number) => b >= lo && b < hi;

    // ── TRACKS (50 tracks in 10 folders) ─────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    // Folder 1: Kick Layers
    const kickFolder = createTrack({ name: '🥁 Kick Layers', kind: 'folder' });
    const kick808 = createTrack({ name: '808 Kick', kind: 'midi', parentId: kickFolder.id });
    const kickSub = createTrack({ name: 'Sub Kick', kind: 'midi', parentId: kickFolder.id });
    const kickClick = createTrack({ name: 'Kick Click', kind: 'midi', parentId: kickFolder.id });

    // Folder 2: Snare & Clap
    const snareFolder = createTrack({ name: '🪘 Snares & Claps', kind: 'folder' });
    const snare808 = createTrack({ name: 'Snare Main', kind: 'midi', parentId: snareFolder.id });
    const clap808 = createTrack({ name: 'Clap Layer', kind: 'midi', parentId: snareFolder.id });
    const ghost = createTrack({ name: 'Ghost Snare', kind: 'midi', parentId: snareFolder.id });

    // Folder 3: Hi-Hats & Cymbals
    const hatFolder = createTrack({ name: '🎩 Hi-Hats', kind: 'folder' });
    const hatClosed = createTrack({ name: 'Closed Hat', kind: 'midi', parentId: hatFolder.id });
    const hatOpen = createTrack({ name: 'Open Hat', kind: 'midi', parentId: hatFolder.id });
    const ride = createTrack({ name: 'Ride Texture', kind: 'midi', parentId: hatFolder.id });

    // Folder 4: Percussion
    const percFolder = createTrack({ name: '🪗 Percussion', kind: 'folder' });
    const conga = createTrack({ name: 'Congas', kind: 'midi', parentId: percFolder.id });
    const cowbell = createTrack({ name: 'Cowbell', kind: 'midi', parentId: percFolder.id });
    const rimshot = createTrack({ name: 'Rimshot', kind: 'midi', parentId: percFolder.id });
    const clave = createTrack({ name: 'Clave', kind: 'midi', parentId: percFolder.id });
    const tomLow = createTrack({ name: 'Tom Low', kind: 'midi', parentId: percFolder.id });
    const tomHigh = createTrack({ name: 'Tom High', kind: 'midi', parentId: percFolder.id });
    const maracas = createTrack({ name: 'Maracas', kind: 'midi', parentId: percFolder.id });

    // Folder 5: Bass
    const bassFolder = createTrack({ name: '🎸 Bass Section', kind: 'folder' });
    const reeseBass = createTrack({ name: 'Reese Bass', kind: 'midi', parentId: bassFolder.id });
    const subBass = createTrack({ name: '808 Sub', kind: 'midi', parentId: bassFolder.id });
    const acidBass = createTrack({ name: 'Acid Bass', kind: 'midi', parentId: bassFolder.id });

    // Folder 6: Keys & Chords
    const keysFolder = createTrack({ name: '🎹 Keys & Chords', kind: 'folder' });
    const rhodes = createTrack({ name: 'Rhodes', kind: 'midi', parentId: keysFolder.id });
    const wurli = createTrack({ name: 'Wurlitzer', kind: 'midi', parentId: keysFolder.id });
    const clavTrack = createTrack({ name: 'Clavinet', kind: 'midi', parentId: keysFolder.id });
    const glassKeys = createTrack({ name: 'Glass Keys', kind: 'midi', parentId: keysFolder.id });

    // Folder 7: Leads & Melodies
    const leadFolder = createTrack({ name: '🎺 Leads', kind: 'folder' });
    const liquidLead = createTrack({ name: 'Liquid Lead', kind: 'midi', parentId: leadFolder.id });
    const screamer = createTrack({ name: 'Screamer', kind: 'midi', parentId: leadFolder.id });
    const flute = createTrack({ name: 'Flute Lead', kind: 'midi', parentId: leadFolder.id });
    const bellMel = createTrack({ name: 'Bell Melody', kind: 'midi', parentId: leadFolder.id });

    // Folder 8: Pads & Textures
    const padFolder = createTrack({ name: '🌊 Pads & Textures', kind: 'folder' });
    const darkDrone = createTrack({ name: 'Dark Drone', kind: 'midi', parentId: padFolder.id });
    const etherealPad = createTrack({ name: 'Ethereal Pad', kind: 'midi', parentId: padFolder.id });
    const warmStrings = createTrack({ name: 'Warm Strings', kind: 'midi', parentId: padFolder.id });
    const nativeAmb = createTrack({ name: 'Native Ambient', kind: 'midi', parentId: padFolder.id });
    const lofiPad = createTrack({ name: 'Lo-Fi Pad', kind: 'midi', parentId: padFolder.id });

    // Folder 9: FX & Glitch
    const fxFolder = createTrack({ name: '🔊 FX & Glitch', kind: 'folder' });
    const noiseSweep = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const glitchPluck = createTrack({ name: 'Glitch Pluck', kind: 'midi', parentId: fxFolder.id });
    const crystalArp = createTrack({ name: 'Crystal Arp', kind: 'midi', parentId: fxFolder.id });
    const darkPulse = createTrack({ name: 'Dark Pulse', kind: 'midi', parentId: fxFolder.id });
    const stab = createTrack({ name: 'Stab FX', kind: 'midi', parentId: fxFolder.id });
    const riser = createTrack({ name: 'Riser', kind: 'midi', parentId: fxFolder.id });

    // Folder 10: Deep Space
    const deepFolder = createTrack({ name: '✨ Deep Space', kind: 'folder' });
    const cosmicDrone = createTrack({ name: 'Cosmic Drone', kind: 'midi', parentId: deepFolder.id });
    const spaceWash = createTrack({ name: 'Space Wash', kind: 'midi', parentId: deepFolder.id });
    const nebulaArp = createTrack({ name: 'Nebula Arp', kind: 'midi', parentId: deepFolder.id });

    // ── APPLY PRESETS (all valid factory IDs) ─────────────────────────────
    const allDrumTracks = [
        kick808,
        kickSub,
        kickClick,
        snare808,
        clap808,
        ghost,
        hatClosed,
        hatOpen,
        ride,
        conga,
        cowbell,
        rimshot,
        clave,
        tomLow,
        tomHigh,
        maracas,
    ];
    for (const t of allDrumTracks) {
        t.devices = [
            {
                id: `dev-${crypto.randomUUID()}`,
                name: '808 Kit',
                type: 'builtin-drum-kit',
                bypassed: false,
                parameterValues: { kit: 0 },
            },
        ];
    }

    applyPreset(reeseBass, 'factory-bass-reese');
    applyPreset(subBass, 'factory-bass-sub');
    applyPreset(acidBass, 'factory-bass-acid');
    applyPreset(rhodes, 'factory-faust-rhodes-ambient');
    applyPreset(wurli, 'factory-keys-bell');
    applyPreset(clavTrack, 'factory-keys-pluck');
    applyPreset(glassKeys, 'factory-faust-additive-glass');
    applyPreset(liquidLead, 'factory-lead-detuned');
    applyPreset(screamer, 'factory-faust-minimoog-lead');
    applyPreset(flute, 'factory-synth-flute');
    applyPreset(bellMel, 'factory-faust-fm-dx-bells');
    applyPreset(darkDrone, 'factory-pad-dark');
    applyPreset(etherealPad, 'factory-faust-fm-pad');
    applyPreset(warmStrings, 'factory-strings-soft');
    applyPreset(nativeAmb, 'factory-faust-supersaw-pad');
    applyPreset(lofiPad, 'factory-pad-warm');
    applyPreset(noiseSweep, 'factory-fx-noise-sweep');
    applyPreset(glitchPluck, 'factory-keys-pluck');
    applyPreset(crystalArp, 'factory-faust-additive-glass');
    applyPreset(darkPulse, 'factory-synth-arp');
    applyPreset(stab, 'factory-fx-stab');
    applyPreset(riser, 'factory-fx-riser');
    applyPreset(cosmicDrone, 'factory-pad-dark');
    applyPreset(spaceWash, 'factory-faust-fm-pad');
    applyPreset(nebulaArp, 'factory-faust-additive-glass');

    // ── FX HELPER ─────────────────────────────────────────────────────────
    const addDev = (t: any, type: string, name: string, params: Record<string, number>) => {
        t.devices = [
            ...(t.devices ?? []),
            { id: `dev-${crypto.randomUUID()}`, name, type, bypassed: false, parameterValues: params },
        ];
    };

    // Master chain
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 2.5,
        'eq-low-freq': 60,
        'eq-low-q': 0.9,
        'eq-mid-gain': -2,
        'eq-mid-freq': 500,
        'eq-mid-q': 1.2,
        'eq-high-gain': 2,
        'eq-high-freq': 10000,
        'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -9,
        'comp-ratio': 2.8,
        'comp-attack': 20,
        'comp-release': 150,
        'comp-knee': 6,
        'comp-makeup': 2,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.25,
        'width-mid': 0,
        'width-side': 1.5,
        'width-mono-bass': 120,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -0.3 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -14 });

    // Per-track FX chains
    addDev(kick808, 'builtin-eq', 'Kick EQ', {
        'eq-low-gain': 5,
        'eq-low-freq': 50,
        'eq-low-q': 1.2,
        'eq-mid-gain': -4,
        'eq-mid-freq': 400,
        'eq-mid-q': 2,
        'eq-high-gain': 1,
        'eq-high-freq': 6000,
        'eq-high-q': 1,
    });
    addDev(kick808, 'builtin-compressor', 'Kick Punch', {
        'comp-threshold': -12,
        'comp-ratio': 6,
        'comp-attack': 5,
        'comp-release': 80,
        'comp-knee': 3,
        'comp-makeup': 4,
    });
    addDev(snare808, 'builtin-reverb', 'Snare Room', {
        'rev-size': 0.3,
        'rev-decay': 0.7,
        'rev-damping': 0.5,
        'rev-mix': 0.15,
    });
    addDev(snare808, 'builtin-eq', 'Snare EQ', {
        'eq-low-gain': -3,
        'eq-low-freq': 200,
        'eq-low-q': 1,
        'eq-mid-gain': 3,
        'eq-mid-freq': 3000,
        'eq-mid-q': 1.5,
        'eq-high-gain': 2,
        'eq-high-freq': 8000,
        'eq-high-q': 0.8,
    });
    addDev(hatClosed, 'builtin-reverb', 'Hat Space', {
        'rev-size': 0.2,
        'rev-decay': 0.5,
        'rev-damping': 0.7,
        'rev-mix': 0.08,
    });
    addDev(reeseBass, 'builtin-distortion', 'Reese Grit', {
        'dist-drive': 3,
        'dist-tone': 1500,
        'dist-mix': 0.15,
        'dist-output': -2,
    });
    addDev(reeseBass, 'builtin-filter', 'Reese Filter', {
        'filter-cutoff': 1800,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(reeseBass, 'builtin-chorus', 'Reese Width', {
        'chorus-rate': 0.08,
        'chorus-depth': 8,
        'chorus-feedback': 0.2,
        'chorus-mix': 0.3,
    });
    addDev(acidBass, 'builtin-distortion', 'Acid Drive', {
        'dist-drive': 5,
        'dist-tone': 2200,
        'dist-mix': 0.2,
        'dist-output': -3,
    });
    addDev(acidBass, 'builtin-delay', 'Acid Echo', { 'delay-time': 180, 'delay-feedback': 0.4, 'delay-mix': 0.22 });
    addDev(rhodes, 'builtin-chorus', 'Rhodes Shimmer', {
        'chorus-rate': 0.3,
        'chorus-depth': 4,
        'chorus-feedback': 0.15,
        'chorus-mix': 0.2,
    });
    addDev(rhodes, 'builtin-delay', 'Rhodes Echo', { 'delay-time': 362, 'delay-feedback': 0.25, 'delay-mix': 0.18 });
    addDev(rhodes, 'builtin-reverb', 'Rhodes Space', {
        'rev-size': 0.65,
        'rev-decay': 2.5,
        'rev-damping': 0.3,
        'rev-mix': 0.18,
    });
    addDev(glassKeys, 'builtin-reverb', 'Glass Hall', {
        'rev-size': 0.9,
        'rev-decay': 5,
        'rev-damping': 0.15,
        'rev-mix': 0.4,
    });
    addDev(glassKeys, 'builtin-chorus', 'Glass Flutter', { 'chorus-rate': 0.18, 'chorus-depth': 9, 'chorus-mix': 0.3 });
    addDev(liquidLead, 'builtin-phaser', 'Liquid Phase', {
        'phaser-rate': 0.15,
        'phaser-depth': 0.8,
        'phaser-feedback': 0.5,
        'phaser-stages': 6,
    });
    addDev(liquidLead, 'builtin-delay', 'Liquid Delay', {
        'delay-time': 362,
        'delay-feedback': 0.38,
        'delay-mix': 0.25,
    });
    addDev(liquidLead, 'builtin-reverb', 'Liquid Space', {
        'rev-size': 0.6,
        'rev-decay': 2,
        'rev-damping': 0.35,
        'rev-mix': 0.22,
    });
    addDev(screamer, 'builtin-distortion', 'Scream Drive', {
        'dist-drive': 8,
        'dist-tone': 3000,
        'dist-mix': 0.25,
        'dist-output': -4,
    });
    addDev(screamer, 'builtin-reverb', 'Scream Hall', {
        'rev-size': 0.7,
        'rev-decay': 2.5,
        'rev-damping': 0.25,
        'rev-mix': 0.28,
    });
    addDev(flute, 'builtin-delay', 'Flute Echo', { 'delay-time': 271, 'delay-feedback': 0.3, 'delay-mix': 0.22 });
    addDev(flute, 'builtin-reverb', 'Flute Space', {
        'rev-size': 0.7,
        'rev-decay': 3,
        'rev-damping': 0.25,
        'rev-mix': 0.25,
    });
    addDev(bellMel, 'builtin-convolution-reverb', 'Bell Hall', {
        'conv-ir': 3,
        'conv-mix': 0.35,
        'conv-predelay': 20,
        'conv-lowcut': 200,
        'conv-highcut': 12000,
    });
    addDev(darkDrone, 'builtin-reverb', 'Drone Verb', {
        'rev-size': 1.0,
        'rev-decay': 15,
        'rev-damping': 0.04,
        'rev-mix': 0.65,
    });
    addDev(darkDrone, 'builtin-flanger', 'Drone Flange', {
        'flanger-rate': 0.03,
        'flanger-depth': 8,
        'flanger-feedback': 0.5,
        'flanger-mix': 0.2,
    });
    addDev(etherealPad, 'builtin-chorus', 'Ether Chorus', {
        'chorus-rate': 0.1,
        'chorus-depth': 14,
        'chorus-feedback': 0.25,
        'chorus-mix': 0.45,
    });
    addDev(etherealPad, 'builtin-reverb', 'Ether Hall', {
        'rev-size': 0.9,
        'rev-decay': 7,
        'rev-damping': 0.1,
        'rev-mix': 0.4,
    });
    addDev(warmStrings, 'builtin-reverb', 'Strings Hall', {
        'rev-size': 0.85,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.3,
    });
    addDev(nativeAmb, 'builtin-reverb', 'Ambient Hall', {
        'rev-size': 0.95,
        'rev-decay': 8,
        'rev-damping': 0.08,
        'rev-mix': 0.5,
    });
    addDev(nativeAmb, 'builtin-chorus', 'Ambient Width', {
        'chorus-rate': 0.07,
        'chorus-depth': 16,
        'chorus-mix': 0.4,
    });
    addDev(crystalArp, 'builtin-delay', 'Crystal Echo', {
        'delay-time': 181,
        'delay-feedback': 0.55,
        'delay-mix': 0.38,
    });
    addDev(crystalArp, 'builtin-autopan', 'Crystal Pan', { 'autopan-rate': 0.35, 'autopan-depth': 0.6 });
    addDev(darkPulse, 'builtin-phaser', 'Pulse Phase', {
        'phaser-rate': 0.2,
        'phaser-depth': 0.7,
        'phaser-feedback': 0.45,
        'phaser-stages': 4,
    });
    addDev(noiseSweep, 'builtin-filter', 'Sweep Filter', {
        'filter-cutoff': 400,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(noiseSweep, 'builtin-reverb', 'Sweep Space', {
        'rev-size': 0.9,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.45,
    });
    addDev(riser, 'builtin-filter', 'Rise Filter', { 'filter-cutoff': 300, 'filter-resonance': 5, 'filter-type': 0 });
    addDev(riser, 'builtin-reverb', 'Rise Space', {
        'rev-size': 0.8,
        'rev-decay': 3.5,
        'rev-damping': 0.25,
        'rev-mix': 0.35,
    });
    addDev(cosmicDrone, 'builtin-reverb', 'Cosmic Verb', {
        'rev-size': 1.0,
        'rev-decay': 18,
        'rev-damping': 0.03,
        'rev-mix': 0.7,
    });
    addDev(spaceWash, 'builtin-chorus', 'Space Chorus', {
        'chorus-rate': 0.06,
        'chorus-depth': 18,
        'chorus-feedback': 0.28,
        'chorus-mix': 0.55,
    });
    addDev(spaceWash, 'builtin-reverb', 'Space Hall', {
        'rev-size': 0.95,
        'rev-decay': 10,
        'rev-damping': 0.06,
        'rev-mix': 0.55,
    });
    addDev(nebulaArp, 'builtin-delay', 'Nebula Delay', { 'delay-time': 271, 'delay-feedback': 0.5, 'delay-mix': 0.4 });
    addDev(nebulaArp, 'builtin-autopan', 'Nebula Pan', { 'autopan-rate': 0.25, 'autopan-depth': 0.55 });
    addDev(lofiPad, 'builtin-flanger', 'LoFi Flange', {
        'flanger-rate': 0.06,
        'flanger-depth': 6,
        'flanger-feedback': 0.3,
        'flanger-mix': 0.2,
    });
    addDev(lofiPad, 'builtin-reverb', 'LoFi Verb', {
        'rev-size': 0.6,
        'rev-decay': 3,
        'rev-damping': 0.4,
        'rev-mix': 0.25,
    });
    addDev(clavTrack, 'builtin-distortion', 'Clav Grit', { 'dist-drive': 2, 'dist-tone': 2000, 'dist-mix': 0.1 });
    addDev(wurli, 'builtin-tremolo', 'Wurli Trem', { 'trem-rate': 4.5, 'trem-depth': 0.3, 'trem-shape': 0 });
    addDev(wurli, 'builtin-chorus', 'Wurli Shimmer', { 'chorus-rate': 0.25, 'chorus-depth': 5, 'chorus-mix': 0.2 });

    // ── PANNING / GAIN for width ─────────────────────────────────────────
    kick808.gain = 0.8;
    kickSub.gain = 0.6;
    kickClick.gain = 0.35;
    snare808.gain = 0.7;
    clap808.gain = 0.55;
    ghost.gain = 0.25;
    hatClosed.gain = 0.5;
    hatOpen.gain = 0.4;
    ride.gain = 0.2;
    conga.gain = 0.4;
    cowbell.gain = 0.3;
    rimshot.gain = 0.35;
    clave.gain = 0.3;
    tomLow.gain = 0.5;
    tomHigh.gain = 0.45;
    maracas.gain = 0.2;
    reeseBass.gain = 0.7;
    subBass.gain = 0.65;
    acidBass.gain = 0.6;
    rhodes.gain = 0.55;
    wurli.gain = 0.4;
    clavTrack.gain = 0.4;
    glassKeys.gain = 0.35;
    liquidLead.gain = 0.7;
    screamer.gain = 0.65;
    flute.gain = 0.5;
    bellMel.gain = 0.35;
    darkDrone.gain = 0.35;
    etherealPad.gain = 0.38;
    warmStrings.gain = 0.42;
    nativeAmb.gain = 0.3;
    lofiPad.gain = 0.25;
    noiseSweep.gain = 0.4;
    glitchPluck.gain = 0.35;
    crystalArp.gain = 0.3;
    darkPulse.gain = 0.35;
    stab.gain = 0.5;
    riser.gain = 0.4;
    cosmicDrone.gain = 0.28;
    spaceWash.gain = 0.22;
    nebulaArp.gain = 0.2;

    hatClosed.pan = 10;
    hatOpen.pan = -15;
    ride.pan = 25;
    conga.pan = -20;
    cowbell.pan = 30;
    rimshot.pan = -10;
    clave.pan = 35;
    maracas.pan = -25;
    tomLow.pan = -30;
    tomHigh.pan = 15;
    rhodes.pan = -20;
    wurli.pan = 15;
    clavTrack.pan = -10;
    glassKeys.pan = 25;
    liquidLead.pan = 10;
    screamer.pan = -15;
    flute.pan = 20;
    bellMel.pan = -25;
    crystalArp.pan = -35;
    darkPulse.pan = 30;
    glitchPluck.pan = -30;
    etherealPad.pan = -5;
    warmStrings.pan = 5;
    cosmicDrone.pan = 0;
    spaceWash.pan = -20;
    nebulaArp.pan = 38;

    // ── CLIPS ────────────────────────────────────────────────────────────
    const mkClip = (t: any, name: string, s: number, e: number) => {
        const c = createMidiClip(t.id, name, s, e, t.color);
        t.clips = [...(t.clips || []), c];
        return c;
    };

    const ck808 = mkClip(kick808, 'Kick 808', 0, TB);
    const cksub = mkClip(kickSub, 'Sub Kick', 64, TB);
    const ckclick = mkClip(kickClick, 'Kick Click', 160, TB);
    const csn = mkClip(snare808, 'Snare', 64, TB);
    const cclap = mkClip(clap808, 'Clap', 160, TB);
    const cghost = mkClip(ghost, 'Ghost', 64, TB);
    const chc = mkClip(hatClosed, 'Closed HH', 0, TB);
    const cho = mkClip(hatOpen, 'Open HH', 64, TB);
    const cride = mkClip(ride, 'Ride', 0, TB);
    const cconga = mkClip(conga, 'Congas', 160, TB);
    const ccow = mkClip(cowbell, 'Cowbell', 288, TB);
    const crim = mkClip(rimshot, 'Rimshot', 64, TB);
    const cclv = mkClip(clave, 'Clave', 160, 720);
    const ctlow = mkClip(tomLow, 'Tom Lo', 288, 720);
    const cthi = mkClip(tomHigh, 'Tom Hi', 288, 720);
    const cmar = mkClip(maracas, 'Maracas', 0, TB);
    const creese = mkClip(reeseBass, 'Reese', 64, TB);
    const csub808 = mkClip(subBass, '808 Sub', 0, TB);
    const cacid = mkClip(acidBass, 'Acid', 288, 720);
    const crhodes = mkClip(rhodes, 'Rhodes', 0, TB);
    const cwurli = mkClip(wurli, 'Wurli', 160, 576);
    const cclav = mkClip(clavTrack, 'Clav', 288, 720);
    const cglass = mkClip(glassKeys, 'Glass', 64, TB);
    const cliquid = mkClip(liquidLead, 'Liquid', 160, 720);
    const cscream = mkClip(screamer, 'Scream', 384, 576);
    const cflute = mkClip(flute, 'Flute', 64, 480);
    const cbell = mkClip(bellMel, 'Bell', 0, TB);
    const cdrone = mkClip(darkDrone, 'Drone', 0, TB);
    const cether = mkClip(etherealPad, 'Ethereal', 160, TB);
    const cwarm = mkClip(warmStrings, 'Strings', 288, TB);
    const cnamb = mkClip(nativeAmb, 'Ambient', 0, TB);
    const clofi = mkClip(lofiPad, 'Lo-Fi', 64, 720);
    const cnoise = mkClip(noiseSweep, 'Sweeps', 0, TB);
    const cglitch = mkClip(glitchPluck, 'Glitch', 160, 720);
    const ccrystal = mkClip(crystalArp, 'Crystal', 288, 720);
    const cdpulse = mkClip(darkPulse, 'Pulse', 160, 576);
    const cstab = mkClip(stab, 'Stab', 160, 720);
    const criser = mkClip(riser, 'Riser', 0, TB);

    // ── NOTE GENERATION ──────────────────────────────────────────────────
    // Note arrays keyed by clip id
    const N: Record<string, MidiNote[]> = {};
    const allClips = [
        ck808,
        cksub,
        ckclick,
        csn,
        cclap,
        cghost,
        chc,
        cho,
        cride,
        cconga,
        ccow,
        crim,
        cclv,
        ctlow,
        cthi,
        cmar,
        creese,
        csub808,
        cacid,
        crhodes,
        cwurli,
        cclav,
        cglass,
        cliquid,
        cscream,
        cflute,
        cbell,
        cdrone,
        cether,
        cwarm,
        cnamb,
        clofi,
        cnoise,
        cglitch,
        ccrystal,
        cdpulse,
        cstab,
        criser,
    ];
    for (const c of allClips) {
        N[c.id] = [];
    }

    const isDense = (b: number) => R(b, 160, 288) || R(b, 384, 480) || R(b, 576, 720);
    const isBreak = (b: number) => R(b, 288, 384) || R(b, 480, 576);

    // ── KICK LAYERS ──────────────────────────────────────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) {
            break;
        }
        const sec = getSec(b);
        const p = b % 4;

        // Kick 808: broken beat patterns — NOT 4-on-floor
        const bar = Math.floor(b / 4);
        const patIdx = bar % 4;
        const kickHits = [
            [0, 1.75, 2.5], // pattern 0
            [0, 0.75, 2, 3.25], // pattern 1
            [0.5, 1.5, 3], // pattern 2
            [0, 1, 2.25, 3.5], // pattern 3
        ][sec.name === 'Fog' ? 0 : sec.name === 'Dust' ? 2 : patIdx]!;

        if (kickHits.includes(p) && !R(b, 720, 816)) {
            N[ck808.id]!.push(note(36, b, 0.4, hv(110)));
        }
        // Sub kick layer (lower velocity, slightly delayed)
        if (b >= 64 && p === 0 && bar % 2 === 0) {
            N[cksub.id]!.push(note(36, b + 0.02, 0.5, hv(75)));
        }
        // Click layer in dense sections
        if (b >= 160 && isDense(b) && kickHits.includes(p)) {
            N[ckclick.id]!.push(note(37, b, 0.05, hv(50))); // rimshot as click
        }

        // Snare: on 2 of each bar + ghost offbeats
        if (b >= 64 && p === 2) {
            N[csn.id]!.push(note(38, b, 0.2, hv(100)));
        }
        // Syncopated snare in dense sections
        if (isDense(b) && (p === 3.5 || (p === 1.25 && bar % 2 === 1))) {
            N[csn.id]!.push(note(38, b, 0.15, hv(80)));
        }

        // Clap: beat 2, layered with snare in dense
        if (b >= 160 && p === 2 && isDense(b)) {
            N[cclap.id]!.push(note(39, b, 0.2, hv(95)));
        }
        // Random clap flams
        if (isDense(b) && p === 2 && bar % 4 === 3) {
            N[cclap.id]!.push(note(39, b - 0.05, 0.1, hv(60)));
        }

        // Ghost notes: tiny snare taps
        if (b >= 64 && p % 0.25 === 0 && Math.random() < 0.12) {
            N[cghost.id]!.push(note(38, b, 0.08, hv(22, 5)));
        }

        // Closed HH: complex swung 16ths with velocity curves
        if (p % 0.25 === 0) {
            const swing = s % 2 === 1 ? 0.03 : 0;
            const accent = p % 1 === 0 ? 70 : p % 0.5 === 0 ? 50 : 30;
            const secVel = sec.name === 'Fog' ? 0.5 : sec.name === 'Dust' ? 0.4 : 1;
            const v = Math.round(accent * secVel);
            if (v > 10) {
                N[chc.id]!.push(note(42, b + swing, 0.1, hv(v)));
            }
        }

        // Open HH: accents
        if (b >= 64 && p === 0.5 && bar % 2 === 1) {
            N[cho.id]!.push(note(46, b, 0.3, hv(55)));
        }

        // Ride texture: sparse, random
        if (p % 1 === 0 && Math.random() < 0.15) {
            N[cride.id]!.push(note(42, b, 0.4, hv(25, 4))); // very quiet ride
        }

        // Maracas: 8th notes in Fog and Dust for texture
        if ((R(b, 0, 64) || R(b, 720, TB)) && p % 0.5 === 0) {
            N[cmar.id]!.push(note(70, b, 0.08, hv(20, 3)));
        }
    }

    // ── PERCUSSION (congas, cowbell, rimshot, clave, toms) ────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        const sec = getSec(bs);

        // Congas: syncopated Latin patterns
        if (bs >= 160) {
            N[cconga.id]!.push(note(62, bs + 0.75, 0.15, hv(50))); // high
            N[cconga.id]!.push(note(63, bs + 2.25, 0.15, hv(45))); // mid
            if (bar % 4 === 3) {
                N[cconga.id]!.push(note(64, bs + 3.5, 0.2, hv(55))); // low fill
                N[cconga.id]!.push(note(62, bs + 3.75, 0.1, hv(40)));
            }
        }

        // Cowbell: offbeat 16ths in Warp and Hyperspace
        if (bs >= 288 && (sec.name === 'Warp' || sec.name === 'Hyperspace')) {
            N[ccow.id]!.push(note(56, bs + 0.25, 0.1, hv(35)));
            N[ccow.id]!.push(note(56, bs + 1.75, 0.1, hv(30)));
            N[ccow.id]!.push(note(56, bs + 3.25, 0.1, hv(38)));
        }

        // Rimshot: 3-2 son clave variant
        if (bs >= 64) {
            const cl = bar % 2;
            if (cl === 0) {
                N[crim.id]!.push(note(37, bs, 0.1, hv(45)));
                N[crim.id]!.push(note(37, bs + 1.5, 0.1, hv(40)));
            } else {
                N[crim.id]!.push(note(37, bs + 1, 0.1, hv(42)));
                N[crim.id]!.push(note(37, bs + 3, 0.1, hv(38)));
            }
        }

        // Clave: every 2 bars in middle sections
        if (bs >= 160 && bs < 720 && bar % 2 === 0) {
            N[cclv.id]!.push(note(75, bs + 0.5, 0.08, hv(40)));
            N[cclv.id]!.push(note(75, bs + 2.5, 0.08, hv(35)));
        }

        // Toms: fills at section boundaries
        if (bs >= 288 && bs < 720 && bs % 32 >= 28) {
            N[ctlow.id]!.push(note(43, bs, 0.3, hv(70)));
            N[cthi.id]!.push(note(50, bs + 1, 0.3, hv(65)));
            N[ctlow.id]!.push(note(47, bs + 2, 0.3, hv(75)));
            N[cthi.id]!.push(note(50, bs + 3, 0.3, hv(60)));
        }
    }

    // ── REESE BASS ───────────────────────────────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || bs >= TB) {
            continue;
        }
        const root = broot(bs);
        const sec = getSec(bs);
        if (sec.name === 'Dust') {
            continue;
        }
        // Syncopated bass — hit on 1, slide on &3
        N[creese.id]!.push(note(root, bs, 1.5, hv(90)));
        N[creese.id]!.push(note(root + 2, bs + 2.5, 1, hv(75)));
        if (isDense(bs)) {
            N[creese.id]!.push(note(root - 5, bs + 1.75, 0.5, hv(70)));
        }
    }

    // ── 808 SUB ──────────────────────────────────────────────────────────
    for (let beat = 0; beat < TB; beat += 4) {
        const root = broot(beat);
        N[csub808.id]!.push(note(root - 12, beat, 3.5, hv(80)));
    }

    // ── ACID BASS (Warp through Hyperspace) ──────────────────────────────
    const acidPat = [
        [0, 0, 0.125],
        [0.25, 12, 0.1],
        [0.5, 7, 0.125],
        [0.75, 0, 0.125],
        [1, 5, 0.25],
        [1.5, 0, 0.25],
        [2, 12, 0.125],
        [2.25, 7, 0.125],
        [2.5, 5, 0.25],
        [3, 0, 0.5],
    ];
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 288 || bs >= 720) {
            continue;
        }
        const root = broot(bs);
        for (const [off, iv, dur] of acidPat) {
            N[cacid.id]!.push(note(root + iv!, bs + off!, dur!, hv(95)));
        }
    }

    // ── RHODES (broken chord comping throughout) ─────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) {
            break;
        }
        const ch = cv(bs);
        const sec = getSec(bs);
        const v = sec.name === 'Fog' || sec.name === 'Dust' ? 50 : 70;
        const pat = bar % 3;
        if (pat === 0) {
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs + 0.1, 2, hv(v)));
            }
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs + 2.75, 0.8, hv(v - 12)));
            }
        } else if (pat === 1) {
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs + 0.5, 3, hv(v - 5)));
            }
        } else {
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs, 0.5, hv(v)));
            }
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs + 1.5, 0.5, hv(v - 8)));
            }
            for (const t of ch) {
                N[crhodes.id]!.push(note(t, bs + 3, 0.8, hv(v - 5)));
            }
        }
    }

    // ── WURLITZER (mid sections, funky stabs) ────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 160 || bs >= 576) {
            continue;
        }
        const ch = cv(bs);
        if (bar % 2 === 0) {
            for (const t of ch) {
                N[cwurli.id]!.push(note(t + 12, bs + 0.75, 0.2, hv(65)));
            }
            for (const t of ch) {
                N[cwurli.id]!.push(note(t + 12, bs + 2.5, 0.15, hv(55)));
            }
        }
    }

    // ── CLAVINET (Warp+, percussive hits) ────────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 288 || bs >= 720) {
            continue;
        }
        const ch = cv(bs);
        N[cclav.id]!.push(note(ch[0]! + 12, bs + 1, 0.15, hv(75)));
        if (bar % 2 === 1) {
            N[cclav.id]!.push(note(ch[2]! + 12, bs + 3.25, 0.1, hv(60)));
        }
    }

    // ── GLASS KEYS (sparse bell-like accents) ────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || bs >= TB) {
            continue;
        }
        const ch = cv(bs);
        if (bar % 4 === 0) {
            N[cglass.id]!.push(note(ch[3]! + 12, bs, 2, hv(55)));
        }
        if (bar % 8 === 4) {
            N[cglass.id]!.push(note(ch[1]! + 12, bs + 2, 1.5, hv(45)));
        }
    }

    // ── LIQUID LEAD (melodic phrases) ────────────────────────────────────
    // Eb minor pentatonic: Eb=63 Gb=66 Ab=68 Bb=70 Db=73 Eb=75
    const lMelA: [number, number, number][] = [
        [0, 75, 1],
        [1.5, 73, 0.5],
        [2, 70, 1.5],
        [4, 68, 1],
        [5, 70, 0.5],
        [5.5, 73, 2.5],
    ];
    const lMelB: [number, number, number][] = [
        [0, 70, 0.5],
        [0.5, 73, 0.5],
        [1, 75, 2],
        [3, 73, 0.5],
        [3.5, 70, 0.5],
        [4, 68, 1.5],
        [6, 66, 1],
        [7, 68, 1],
    ];
    for (let ph = 0; ph < (720 - 160) / 8; ph++) {
        const start = 160 + ph * 8;
        if (start >= 720) {
            break;
        }
        if (isBreak(start) && ph % 2 === 0) {
            continue;
        } // leave space
        const mel = ph % 2 === 0 ? lMelA : lMelB;
        for (const [off, pitch, dur] of mel) {
            N[cliquid.id]!.push(note(pitch, start + off, dur, hv(80)));
        }
    }

    // ── SCREAMER (Collapse section only — intense) ───────────────────────
    const sMel: [number, number, number][] = [
        [0, 75, 0.5],
        [0.5, 78, 0.5],
        [1, 80, 1.5],
        [3, 78, 1],
        [4, 75, 0.5],
        [4.5, 73, 0.5],
        [5, 70, 2],
        [7, 73, 1],
    ];
    for (let ph = 0; ph < (576 - 384) / 8; ph++) {
        const start = 384 + ph * 8;
        for (const [off, pitch, dur] of sMel) {
            N[cscream.id]!.push(note(pitch, start + off, dur, hv(100)));
        }
    }

    // ── FLUTE (Fracture through Collapse, gentle) ────────────────────────
    const fMelodies: [number, number, number][][] = [
        [
            [0, 68, 2],
            [2.5, 70, 1],
            [4, 73, 1.5],
            [6, 70, 1],
            [7, 68, 1],
        ],
        [
            [0, 73, 1],
            [1.5, 75, 0.5],
            [2, 73, 2],
            [4.5, 70, 1.5],
            [6.5, 68, 1.5],
        ],
        [
            [0, 66, 2],
            [2.5, 68, 1],
            [4, 70, 2],
            [6.5, 73, 1.5],
        ],
    ];
    for (let ph = 0; ph < (480 - 64) / 8; ph++) {
        const start = 64 + ph * 8;
        if (start >= 480) {
            break;
        }
        if (isDense(start) && ph % 3 !== 0) {
            continue;
        }
        const mel = fMelodies[ph % fMelodies.length]!;
        for (const [off, pitch, dur] of mel) {
            N[cflute.id]!.push(note(pitch, start + off, dur, hv(65)));
        }
    }

    // ── BELL MELODY (sparse throughout) ──────────────────────────────────
    for (let beat = 0; beat < TB; beat += 16) {
        const ch = cv(beat);
        N[cbell.id]!.push(note(ch[2]! + 24, beat + 2, 2, hv(40)));
        if (beat % 32 === 0) {
            N[cbell.id]!.push(note(ch[0]! + 24, beat + 10, 3, hv(35)));
        }
    }

    // ── PADS & TEXTURES ──────────────────────────────────────────────────
    // Dark Drone: sustained throughout
    for (let beat = 0; beat < TB; beat += 32) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 3)) {
            N[cdrone.id]!.push(note(t - 12, beat, 31, hv(35)));
        }
    }
    // Ethereal Pad: mid sections
    for (let beat = 160; beat < TB; beat += 16) {
        const ch = cv(beat);
        for (const t of ch) {
            N[cether.id]!.push(note(t + 12, beat, 15, hv(40)));
        }
    }
    // Warm Strings: from Warp onward
    for (let beat = 288; beat < TB; beat += 16) {
        const ch = cv(beat);
        for (const t of ch) {
            N[cwarm.id]!.push(note(t, beat, 15.5, hv(45)));
        }
    }
    // Native Ambient: throughout, very subtle
    for (let beat = 0; beat < TB; beat += 32) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 2)) {
            N[cnamb.id]!.push(note(t + 12, beat, 30, hv(30)));
        }
    }
    // Lo-Fi Pad: Fracture through Hyperspace
    for (let beat = 64; beat < 720; beat += 16) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 3)) {
            N[clofi.id]!.push(note(t, beat, 15, hv(35)));
        }
    }

    // ── FX & GLITCH ──────────────────────────────────────────────────────
    // Noise sweeps before section changes
    const sweepBeats = [48, 144, 272, 368, 464, 560, 704];
    for (const sb of sweepBeats) {
        N[cnoise.id]!.push(note(60, sb, 16, 65));
    }

    // Glitch pluck: rapid random in dense sections
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 160 || b >= 720 || !isDense(b)) {
            continue;
        }
        if (Math.random() < 0.06) {
            const pitch = 60 + Math.floor(Math.random() * 24);
            N[cglitch.id]!.push(note(pitch, b, 0.08, hv(55)));
        }
    }

    // Crystal arp: 16th note patterns in Warp+
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 288 || b >= 720) {
            continue;
        }
        const ch = cv(b);
        const idx = s % ch.length;
        const oct = Math.floor(s / ch.length) % 3 === 0 ? 12 : 0;
        N[ccrystal.id]!.push(note(ch[idx]! + 12 + oct, b, 0.15, hv(50)));
    }

    // Dark pulse: 16th notes in Gravity through Nebula
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 160 || b >= 576) {
            continue;
        }
        if (s % 2 === 0) {
            N[cdpulse.id]!.push(note(broot(b), b, 0.1, hv(45)));
        }
    }

    // Stabs: accent chords in drops
    for (let beat = 160; beat < 720; beat += 8) {
        if (isBreak(beat)) {
            continue;
        }
        const ch = cv(beat);
        for (const t of ch) {
            N[cstab.id]!.push(note(t + 12, beat, 0.1, hv(85)));
        }
    }

    // Risers before every section
    for (const sec of SECTIONS) {
        if (sec.start > 0) {
            N[criser.id]!.push(note(60, sec.start - 16, 16, 70));
        }
    }

    // Deep Space clip/note generation
    const mkC2 = (t: any, name: string, s: number, e: number) => {
        const c = createMidiClip(t.id, name, s, e, t.color);
        t.clips = [...(t.clips ?? []), c];
        return c;
    };
    const cCosmic = mkC2(cosmicDrone, 'Cosmic Drone', 0, TB);
    const cSpace = mkC2(spaceWash, 'Space Wash', 0, TB);
    const cNebula = mkC2(nebulaArp, 'Nebula Arp', 288, 720);
    const cosmicN: MidiNote[] = [],
        spaceN: MidiNote[] = [],
        nebN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 32) {
        const ch = cv(b);
        for (const t of ch.slice(0, 3)) {
            cosmicN.push(note(t - 24, b, 31, hv(22)));
            spaceN.push(note(t + 12, b, 31, hv(27)));
        }
    }
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 288 || b >= 720) {
            continue;
        }
        const ch = cv(b);
        nebN.push(note(ch[s % ch.length]! + 24, b, 0.2, hv(35)));
    }
    N[cCosmic.id] = cosmicN;
    N[cSpace.id] = spaceN;
    N[cNebula.id] = nebN;

    // ── ASSEMBLE ALL TRACKS ──────────────────────────────────────────────
    const tracks = [
        masterTrack,
        kickFolder,
        kick808,
        kickSub,
        kickClick,
        snareFolder,
        snare808,
        clap808,
        ghost,
        hatFolder,
        hatClosed,
        hatOpen,
        ride,
        percFolder,
        conga,
        cowbell,
        rimshot,
        clave,
        tomLow,
        tomHigh,
        maracas,
        bassFolder,
        reeseBass,
        subBass,
        acidBass,
        keysFolder,
        rhodes,
        wurli,
        clavTrack,
        glassKeys,
        leadFolder,
        liquidLead,
        screamer,
        flute,
        bellMel,
        padFolder,
        darkDrone,
        etherealPad,
        warmStrings,
        nativeAmb,
        lofiPad,
        fxFolder,
        noiseSweep,
        glitchPluck,
        crystalArp,
        darkPulse,
        stab,
        riser,
        deepFolder,
        cosmicDrone,
        spaceWash,
        nebulaArp,
    ];
    trackStore.set({ tracks, selectedTrackId: liquidLead.id });

    midiStore.set({
        notesByClipId: N,
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION (12 lanes — go crazy) ─────────────────────────────────
    const mkLane = (trackId: string, param: string, name: string, min: number, max: number) =>
        createAutomationLane(trackId, param, name, min, max);

    const kickVol = mkLane(kick808.id, 'volume', 'Volume', 0, 1);
    kickVol.points = [
        { beat: 0, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 160, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const reeseVol = mkLane(reeseBass.id, 'volume', 'Volume', 0, 1);
    reeseVol.points = [
        { beat: 64, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const droneVol = mkLane(darkDrone.id, 'volume', 'Volume', 0, 1);
    droneVol.points = [
        { beat: 0, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.3, curve: 'linear', tension: 0 },
    ];

    const rhodesVol = mkLane(rhodes.id, 'volume', 'Volume', 0, 1);
    rhodesVol.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const etherVol = mkLane(etherealPad.id, 'volume', 'Volume', 0, 1);
    etherVol.points = [
        { beat: 160, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.5, curve: 'linear', tension: 0 },
    ];

    const acidVol = mkLane(acidBass.id, 'volume', 'Volume', 0, 1);
    acidVol.points = [
        { beat: 288, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const glitchVol = mkLane(glitchPluck.id, 'volume', 'Volume', 0, 1);
    glitchVol.points = [
        { beat: 160, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const crystalVol = mkLane(crystalArp.id, 'volume', 'Volume', 0, 1);
    crystalVol.points = [
        { beat: 288, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const liquidVol = mkLane(liquidLead.id, 'volume', 'Volume', 0, 1);
    liquidVol.points = [
        { beat: 160, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 192, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const hatVol = mkLane(hatClosed.id, 'volume', 'Volume', 0, 1);
    hatVol.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const warmVol = mkLane(warmStrings.id, 'volume', 'Volume', 0, 1);
    warmVol.points = [
        { beat: 288, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 352, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.8, curve: 'linear', tension: 0 },
    ];

    const screamVol = mkLane(screamer.id, 'volume', 'Volume', 0, 1);
    screamVol.points = [
        { beat: 384, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 400, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 560, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.0, curve: 'linear', tension: 0 },
    ];

    // Dramatic FX automation lanes
    const liquidPhaseMix = mkLane(liquidLead.id, 'phaser-depth', 'Phaser Depth', 0, 1);
    liquidPhaseMix.points = [
        { beat: 160, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.2, curve: 'linear', tension: 0 },
    ];

    const reeseRevMix = mkLane(reeseBass.id, 'rev-mix', 'Reverb Mix', 0, 0.6);
    reeseRevMix.points = [
        { beat: 64, value: 0, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.05, curve: 'linear', tension: 0 },
    ];

    const droneRevMix = mkLane(darkDrone.id, 'rev-mix', 'Reverb Mix', 0, 1);
    droneRevMix.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.95, curve: 'linear', tension: 0 },
    ];

    const etherRevMix = mkLane(etherealPad.id, 'rev-mix', 'Reverb Mix', 0, 1);
    etherRevMix.points = [
        { beat: 160, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.9, curve: 'linear', tension: 0 },
    ];

    const acidDelayFb = mkLane(acidBass.id, 'delay-feedback', 'Delay FB', 0, 0.9);
    acidDelayFb.points = [
        { beat: 288, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 468, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const cosmicVol = mkLane(cosmicDrone.id, 'volume', 'Volume', 0, 1);
    cosmicVol.points = [
        { beat: 0, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.9, curve: 'linear', tension: 0 },
    ];

    const spaceVol = mkLane(spaceWash.id, 'volume', 'Volume', 0, 1);
    spaceVol.points = [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.8, curve: 'linear', tension: 0 },
    ];

    const rhodesRevMix = mkLane(rhodes.id, 'rev-mix', 'Reverb Mix', 0, 1);
    rhodesRevMix.points = [
        { beat: 0, value: 0.06, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 480, value: 0.28, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 816, value: 0.6, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            kickVol,
            reeseVol,
            droneVol,
            rhodesVol,
            etherVol,
            acidVol,
            glitchVol,
            crystalVol,
            liquidVol,
            hatVol,
            warmVol,
            screamVol,
            liquidPhaseMix,
            reeseRevMix,
            droneRevMix,
            etherRevMix,
            acidDelayFb,
            cosmicVol,
            spaceVol,
            rhodesRevMix,
        ],
    });

    // ── MARKERS ──────────────────────────────────────────────────────────
    const secColors = [
        'oklch(0.30 0.08 270)',
        'oklch(0.35 0.10 300)',
        'oklch(0.40 0.13 350)',
        'oklch(0.38 0.12 30)',
        'oklch(0.42 0.15 10)',
        'oklch(0.38 0.10 200)',
        'oklch(0.45 0.18 60)',
        'oklch(0.32 0.06 240)',
    ];
    markerStore.set({
        markers: SECTIONS.map((s, i) => ({
            id: crypto.randomUUID(),
            beat: s.start,
            name: s.name,
            color: secColors[i]!,
        })),
        sections: SECTIONS.map((s, i) => ({
            id: crypto.randomUUID(),
            startBeat: s.start,
            endBeat: s.end,
            name: s.name,
            color: secColors[i]!,
        })),
    });

    syncArrangement(tracks);

    const { ensureTrackStrips } = await import('#/modules/Transport');
    ensureTrackStrips();
    const { waitForDevices } = await import('#/modules/AudioEngine');
    await waitForDevices();

    projectStore.set({
        name: 'Brainfeeder (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
        initialized: true,
    });
}
