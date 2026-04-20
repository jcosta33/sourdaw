/**
 * Demo — Sweet Dreams (Are Made of This)
 * A faithful cover of Eurythmics' 1983 classic.
 * Key: C minor | BPM: 125 | ~320 beats (2:34)
 *
 * Track architecture:
 *   1. Synth Riff R — Right-panned steady eighth-note riff (Fermenter, custom analog params)
 *   2. Synth Riff L — Left-panned syncopated complementary riff (Fermenter, custom analog params)
 *   3. Bass — Pumping synth bass on root movement (Fermenter, fermenter-moog-bass)
 *   4. Pad/Strings — Atmospheric CS-80 layer (Fermenter, fermenter-cs80-pad)
 *   5. Lead Synth — Vocal melody transcription (Fermenter, fermenter-classic-lead + portamento)
 *   6. Brass Stabs — Staccato DX7 brass hits (Fermenter, fermenter-dx7-brass)
 *   7. Drums — Toaster kit: folder + pad children (kick, snare/clap, hi-hat)
 */

import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectStore } from '../../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import type { MidiNote } from '../../../models/DemoProjectTypes';
import { note } from '../demoUtils/note';
import { applyPreset } from '../demoUtils/applyPreset';
import { createMidiClip } from '../demoUtils/createMidiClip';
import { syncArrangement } from '../demoUtils/syncArrangement';
import { DEFAULT_PAD_NAMES } from '#/modules/Toaster/useCases';

const TB = 320; // total beats (~2:34 at 125 BPM)
const bpm = 125;

// ── MIDI pitch constants (C minor) ──────────────────────────────────────
const C2 = 36;
const Ab1 = 32;
const G2 = 43;
const Ab2 = 44;
const Bb2 = 46;
const C3 = 48;
const Eb3 = 51;
const G3 = 55;
const Ab3 = 56;
const Bb3 = 58;
const C4 = 60;
const Eb4 = 63;
const F4 = 65;
const G4 = 67;
const Ab4 = 68;
const Bb4 = 70;
const C5 = 72;
const Eb5 = 75;

// ── Section boundaries (beats) ───────────────────────────────────────────
// 8-bar intro, verse/pre-chorus/chorus pairs, bridge, final chorus, outro
const S = {
    intro: 0, // 8 bars (32 beats) — just the two synth riffs
    verse1: 32, // 8 bars (32 beats) — add bass, drums, pad
    preChorus1: 64, // 4 bars (16 beats) — melody enters
    chorus1: 80, // 8 bars (32 beats) — full arrangement
    verse2: 112, // 8 bars (32 beats)
    preChorus2: 144, // 4 bars (16 beats)
    chorus2: 160, // 8 bars (32 beats)
    bridge: 192, // 8 bars (32 beats) — strip back, Bb and G chords
    finalChorus: 224, // 8 bars (32 beats) — biggest section
    outro: 256, // 8-16 bars (32-64 beats) — fade out
    end: TB,
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────
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

/** Slight humanization for velocity */
const hv = (base: number, range = 6) =>
    Math.max(1, Math.min(127, Math.round(base + (Math.random() - 0.5) * range * 2)));

// ═════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═════════════════════════════════════════════════════════════════════════
export async function demo_SweetDreams(): Promise<void> {
    // ── TRACKS ────────────────────────────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    const synthFolder = createTrack({ name: '🎹 Synths', kind: 'folder' });
    const tRiffR = createTrack({ name: 'Synth Riff R', kind: 'midi', parentId: synthFolder.id });
    const tRiffL = createTrack({ name: 'Synth Riff L', kind: 'midi', parentId: synthFolder.id });
    const tBass = createTrack({ name: 'Bass', kind: 'midi', parentId: synthFolder.id });
    const tPad = createTrack({ name: 'Pad / Strings', kind: 'midi', parentId: synthFolder.id });
    const tLead = createTrack({ name: 'Lead Synth', kind: 'midi', parentId: synthFolder.id });
    const tBrass = createTrack({ name: 'Brass Stabs', kind: 'midi', parentId: synthFolder.id });

    // ── Toaster drums: folder + pad children ─────────────────────────────
    const toasterFolder = createTrack({ name: '🥁 Drums', kind: 'folder' });
    toasterFolder.color = 'oklch(0.39 0.024 30)';
    toasterFolder.collapsed = false;
    const toasterDeviceId = `toaster-${crypto.randomUUID().slice(0, 8)}`;
    toasterFolder.devices = [
        {
            id: toasterDeviceId,
            name: 'Toaster',
            type: 'toaster',
            bypassed: false,
            parameterValues: {
                masterGain: 1.2,
                reverbMix: 0.08,
                delayMix: 0.04,
                swing: 0,
            },
        },
    ];

    // 16 pad children (we only use pads 0=kick, 1=snare/clap, 2=closed hat, 3=open hat)
    const DRUM_PAD_COLORS: readonly string[] = Array.from({ length: 16 }, (_, i) => {
        const h = Math.round((i * 360) / 16 + 15);
        return `oklch(0.42 0.03 ${h})`;
    });

    const toasterPadTracks = Array.from({ length: 16 }, (_, i) => {
        const child = createTrack({
            name: DEFAULT_PAD_NAMES[i] ?? `Pad ${i + 1}`,
            kind: 'midi',
            parentId: toasterFolder.id,
        });
        child.devices = [];
        child.outputId = toasterFolder.id;
        child.color = DRUM_PAD_COLORS[i] ?? child.color;
        return child;
    });

    // ── INSTRUMENTS ──────────────────────────────────────────────────────
    // Synth Riff — Oberheim OB-X style: two detuned saws with PWM-like
    // movement. The original used pulse width modulation via LFO to create
    // the thickening/thinning effect. Both L and R use the same patch.
    const riffParams = {
        oscEngine: 1, // VA analog
        oscWaveform: 1, // saw
        unisonVoices: 2, // two detuned saws (like the original OB-X)
        unisonDetune: 8, // ~8% detune for width
        filterModel: 0, // SVF (clean, not aggressive)
        filterCutoff: 3500,
        filterResonance: 1.5,
        ampAttack: 0.008,
        ampDecay: 0.2,
        ampSustain: 0.7,
        ampRelease: 0.12,
        lfoRate: 0.3, // slow LFO for PWM-like sweep
        lfoFilterAmount: 0.15,
        chorusMix: 0.2,
        chorusRate: 0.6,
        chorusDepth: 6,
    };
    tRiffR.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Fermenter',
            type: 'fermenter',
            bypassed: false,
            parameterValues: { ...riffParams },
        },
    ];
    tRiffL.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Fermenter',
            type: 'fermenter',
            bypassed: false,
            parameterValues: { ...riffParams },
        },
    ];

    // Bass — Roland SH-101 style: simple mono saw, clean filter, punchy
    // The original bass was an SH-101 sequenced by the drum computer.
    // NOT a fat Moog — cleaner, thinner, more precise.
    tBass.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: 'Fermenter',
            type: 'fermenter',
            bypassed: false,
            parameterValues: {
                oscEngine: 1, // VA
                oscWaveform: 1, // saw
                filterModel: 0, // SVF (clean like SH-101)
                filterCutoff: 1200,
                filterResonance: 1.5,
                ampAttack: 0.003,
                ampDecay: 0.25,
                ampSustain: 0.5,
                ampRelease: 0.1,
                filterDecay: 0.15,
                filterEnvAmount: 0.3,
                reverbMix: 0, // bone dry
            },
        },
    ];

    // Pad — Oberheim string/pad: Annie Lennox played the OB-X for a string
    // sound "cut off to make it more attacking." Use the Oberheim preset
    // with adjusted attack for that cutting quality.
    applyPreset(tPad, 'fermenter-oberheim-pad');
    if (tPad.devices[0]) {
        const pv = tPad.devices[0].parameterValues;
        pv.ampAttack = 0.15; // shorter than default pad — "cut off" per Dave Stewart
        pv.filterCutoff = 2200; // slightly darker
        pv.reverbMix = 0.35;
        pv.chorusMix = 0.25;
    }

    // Lead — vocal substitute. The melody needs a warm, slightly nasal
    // quality to evoke Annie Lennox's voice. Formant filter gives vowel
    // character. Use the vocal pad preset with shorter attack.
    applyPreset(tLead, 'fermenter-vocal-pad');
    if (tLead.devices[0]) {
        const pv = tLead.devices[0].parameterValues;
        pv.ampAttack = 0.03; // faster attack for melodic articulation
        pv.ampRelease = 0.3;
        pv.portamentoTime = 0.03; // slight legato glide
        pv.filterCutoff = 3000;
        pv.filterResonance = 3; // formant peak for vocal quality
    }

    // Stab accents — NOT brass. The original has no brass stabs.
    // Instead, use a soft Juno-style chord stab — the same Cm chord
    // played staccato as rhythmic punctuation, much gentler.
    applyPreset(tBrass, 'fermenter-juno-pad');
    if (tBrass.devices[0]) {
        const pv = tBrass.devices[0].parameterValues;
        pv.ampAttack = 0.01;
        pv.ampDecay = 0.2;
        pv.ampSustain = 0.3;
        pv.ampRelease = 0.15;
        pv.filterCutoff = 2000;
    }

    // ── EFFECTS CHAINS ──────────────────────────────────────────────────
    // Synth Riff R: chorus + delay
    addDev(tRiffR, 'builtin-chorus', 'Riff Chorus', {
        'chorus-rate': 0.8,
        'chorus-depth': 5,
        'chorus-feedback': 0.12,
        'chorus-mix': 0.25,
    });
    addDev(tRiffR, 'builtin-delay', 'Riff Delay', {
        'delay-time': 240,
        'delay-feedback': 0.2,
        'delay-mix': 0.15,
    });
    // Synth Riff L: chorus + delay (same chain)
    addDev(tRiffL, 'builtin-chorus', 'Riff Chorus', {
        'chorus-rate': 0.8,
        'chorus-depth': 5,
        'chorus-feedback': 0.12,
        'chorus-mix': 0.25,
    });
    addDev(tRiffL, 'builtin-delay', 'Riff Delay', {
        'delay-time': 240,
        'delay-feedback': 0.2,
        'delay-mix': 0.15,
    });

    // Bass: just a compressor — the SH-101 sound was clean and precise
    addDev(tBass, 'builtin-compressor', 'Bass Comp', {
        'comp-threshold': -12,
        'comp-ratio': 4,
        'comp-attack': 5,
        'comp-release': 120,
        'comp-knee': 4,
        'comp-makeup': 1.5,
    });

    // Pad: large reverb + chorus
    addDev(tPad, 'builtin-reverb', 'Pad Hall', {
        'rev-size': 0.85,
        'rev-decay': 4.5,
        'rev-damping': 0.2,
        'rev-mix': 0.5,
    });
    addDev(tPad, 'builtin-chorus', 'Pad Chorus', {
        'chorus-rate': 0.3,
        'chorus-depth': 8,
        'chorus-feedback': 0.15,
        'chorus-mix': 0.3,
    });

    // Lead: dotted 8th delay + reverb
    addDev(tLead, 'builtin-delay', 'Lead Delay', {
        'delay-time': 375,
        'delay-feedback': 0.25,
        'delay-mix': 0.2,
    });
    addDev(tLead, 'builtin-reverb', 'Lead Space', {
        'rev-size': 0.5,
        'rev-decay': 2,
        'rev-damping': 0.3,
        'rev-mix': 0.2,
    });

    // Chord accent: just a touch of reverb for space
    addDev(tBrass, 'builtin-reverb', 'Accent Space', {
        'rev-size': 0.4,
        'rev-decay': 1.5,
        'rev-damping': 0.35,
        'rev-mix': 0.2,
    });

    // ── MASTER CHAIN ─────────────────────────────────────────────────────
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 2,
        'eq-low-freq': 80,
        'eq-low-q': 0.8,
        'eq-mid-gain': 0.5,
        'eq-mid-freq': 3000,
        'eq-mid-q': 1,
        'eq-high-gain': 1,
        'eq-high-freq': 10000,
        'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -12,
        'comp-ratio': 3,
        'comp-attack': 25,
        'comp-release': 180,
        'comp-knee': 8,
        'comp-makeup': 2,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.15,
        'width-mid': 0,
        'width-side': 1.3,
        'width-mono-bass': 160,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -0.5 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -14 });

    // ── INITIAL LEVELS & PANS ────────────────────────────────────────────
    tRiffR.gain = 0.7;
    tRiffL.gain = 0.55; // sits behind the right — glues together as one riff
    tBass.gain = 0; // enters via automation
    tPad.gain = 0; // enters via automation
    tLead.gain = 0; // enters via automation
    tBrass.gain = 0; // enters via automation
    toasterFolder.gain = 0;

    tRiffR.pan = 40;
    tRiffL.pan = -40;
    tBass.pan = 0;
    tPad.pan = 0;
    tLead.pan = 0;
    tBrass.pan = -15;

    for (const pad of toasterPadTracks) {
        pad.gain = 1;
    }

    // ══════════════════════════════════════════════════════════════════════
    // MIDI CLIPS
    // ══════════════════════════════════════════════════════════════════════
    const clip = (trackId: string, name: string) => createMidiClip(trackId, name, 0, TB);

    const cRiffR = clip(tRiffR.id, 'Riff R');
    const cRiffL = clip(tRiffL.id, 'Riff L');
    const cBass = clip(tBass.id, 'Bass');
    const cPad = clip(tPad.id, 'Pad');
    const cLead = clip(tLead.id, 'Lead Melody');
    const cBrass = clip(tBrass.id, 'Brass Stabs');

    // ══════════════════════════════════════════════════════════════════════
    // 1. THE ICONIC DUAL SYNTH RIFF — C minor
    // The signature sound is TWO synth sequences panned hard left and right.
    // Together they create the illusion of one complex arpeggio.
    // ══════════════════════════════════════════════════════════════════════
    const riffRNotes: MidiNote[] = [];
    const riffLNotes: MidiNote[] = [];

    // Right channel: steady eighth notes, 16 per 2-bar (8-beat) cycle
    // C3 C3 C3 C3 | Eb3 Eb3 C3 C3 | Ab2 Ab2 Ab2 C3 | G2 G2 G2 C3
    const riffRPattern: [number, number, number][] = [
        [0, C3, 95],
        [0.5, C3, 78],
        [1, C3, 90],
        [1.5, C3, 75],
        [2, Eb3, 88],
        [2.5, Eb3, 72],
        [3, C3, 85],
        [3.5, C3, 70],
        [4, Ab2, 92],
        [4.5, Ab2, 75],
        [5, Ab2, 88],
        [5.5, C3, 72],
        [6, G2, 90],
        [6.5, G2, 74],
        [7, G2, 86],
        [7.5, C3, 68],
    ];

    // Left channel: follows the same harmonic movement as the right but
    // with a slightly different rhythmic feel — longer notes, more legato,
    // filling in the spaces. This is what makes it sound like ONE riff
    // when the two are combined. The left was played by Annie on the OB-X
    // while the right was the SH-101 sequence.
    const riffLPattern: [number, number, number][] = [
        [0, C3, 82],
        [1, C3, 78],
        [2, Eb3, 80],
        [3, C3, 75],
        [4, Ab2, 82],
        [5, Ab2, 76],
        [6, G2, 80],
        [7, C3, 72],
    ];

    // Both riffs play throughout; gain automation controls dynamics
    const outroFade = S.outro + 48;
    for (let cycle = 0; cycle * 8 < outroFade; cycle++) {
        const cycleStart = cycle * 8;
        if (cycleStart >= TB) {break;}
        const isChorus =
            (cycleStart >= S.chorus1 && cycleStart < S.verse2) ||
            (cycleStart >= S.chorus2 && cycleStart < S.bridge) ||
            (cycleStart >= S.finalChorus && cycleStart < S.outro);
        const isIntro = cycleStart < S.verse1;
        const velMult = isChorus ? 1.05 : isIntro ? 0.85 : 1.0;

        for (const [offset, pitch, baseVel] of riffRPattern) {
            const beat = cycleStart + offset;
            if (beat >= TB) {break;}
            riffRNotes.push(note(pitch, beat, 0.4, hv(Math.round(baseVel * velMult), 4)));
        }
        for (const [offset, pitch, baseVel] of riffLPattern) {
            const beat = cycleStart + offset;
            if (beat >= TB) {break;}
            // Longer notes (0.85) and softer than right — quarter-note feel that
            // fills underneath the right channel's staccato eighths
            riffLNotes.push(note(pitch, beat, 0.85, hv(Math.round(baseVel * velMult * 0.9), 3)));
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2. BASS — Pumping synth bass on C minor roots, enters at verse 1
    // Simple, driving, anchored. Quarter notes on root with occasional
    // octave jump. Cm bars = C2, Ab bars = Ab1.
    // 4-bar pattern (16 beats): Cm | Cm | Ab | Ab
    // ══════════════════════════════════════════════════════════════════════
    const bassNotes: MidiNote[] = [];

    // 4-bar bass cycle: Cm | Cm | Ab | Ab
    // Simple quarter-note pulse — the SH-101 was triggered by the drum
    // machine, giving it a completely mechanical, locked feel.
    // Moderate velocity — sits UNDER the riffs, not competing.
    const bassPattern: [number, number, number, number][] = [
        // Bar 1-2: C root, quarter notes with one octave jump
        [0, C2, 0.85, 72],
        [1, C2, 0.85, 65],
        [2, C2, 0.85, 70],
        [3, C3, 0.85, 60], // octave jump
        [4, C2, 0.85, 72],
        [5, C2, 0.85, 64],
        [6, C2, 0.85, 68],
        [7, C2, 0.85, 62],
        // Bar 3-4: Ab root
        [8, Ab1, 0.85, 70],
        [9, Ab1, 0.85, 63],
        [10, Ab1, 0.85, 68],
        [11, Ab2, 0.85, 58], // octave jump
        [12, Ab1, 0.85, 70],
        [13, Ab1, 0.85, 62],
        [14, Ab1, 0.85, 66],
        [15, Ab1, 1.6, 68], // slightly longer into next cycle
    ];

    // Bridge bass: Cm | Cm | Ab | Ab | Bb | Bb | G | G
    const bridgeBassPattern: [number, number, number, number][] = [
        // Cm bars
        [0, C2, 0.9, 90],
        [1, C2, 0.9, 78],
        [2, C2, 0.9, 85],
        [3, C2, 0.9, 72],
        [4, C2, 0.9, 88],
        [5, C2, 0.9, 76],
        [6, C2, 0.9, 82],
        [7, C2, 0.9, 70],
        // Ab bars
        [8, Ab1, 0.9, 88],
        [9, Ab1, 0.9, 75],
        [10, Ab1, 0.9, 82],
        [11, Ab1, 0.9, 70],
        [12, Ab1, 0.9, 85],
        [13, Ab1, 0.9, 72],
        [14, Ab1, 0.9, 80],
        [15, Ab1, 0.9, 68],
        // Bb bars
        [16, Bb2, 0.9, 90],
        [17, Bb2, 0.9, 78],
        [18, Bb2, 0.9, 85],
        [19, Bb2, 0.9, 72],
        [20, Bb2, 0.9, 88],
        [21, Bb2, 0.9, 76],
        [22, Bb2, 0.9, 82],
        [23, Bb2, 0.9, 70],
        // G bars
        [24, G2, 0.9, 88],
        [25, G2, 0.9, 75],
        [26, G2, 0.9, 82],
        [27, G2, 0.9, 70],
        [28, G2, 0.9, 85],
        [29, G2, 0.9, 72],
        [30, G2, 0.9, 80],
        [31, G2, 1.8, 88],
    ];

    for (let cycle = Math.floor(S.verse1 / 16); cycle * 16 < S.outro + 32; cycle++) {
        const cycleStart = cycle * 16;
        if (cycleStart >= TB) {break;}
        const isBridge = cycleStart >= S.bridge && cycleStart < S.finalChorus;

        if (isBridge) {
            // Bridge uses special pattern (32 beats), only emit once from bridge start
            if (cycleStart === S.bridge) {
                for (const [offset, pitch, dur, vel] of bridgeBassPattern) {
                    const beat = S.bridge + offset;
                    if (beat >= S.finalChorus || beat >= TB) {break;}
                    bassNotes.push(note(pitch, beat, dur, hv(vel, 5)));
                }
            }
            continue;
        }

        for (const [offset, pitch, dur, vel] of bassPattern) {
            const beat = cycleStart + offset;
            if (beat < S.verse1 || beat >= TB) {continue;}
            if (beat >= S.bridge && beat < S.finalChorus) {continue;}
            bassNotes.push(note(pitch, beat, dur, hv(vel, 5)));
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 3. PAD / STRINGS — Sustained chord voicings
    // Verse: Cm (C4-Eb4-G4), Ab (Ab3-C4-Eb4)
    // Chorus: Cm-Ab vamp with Fm. Bridge: Cm-Ab-Bb-G
    // Slow attack, wide, lush. 8-beat sustains.
    // ══════════════════════════════════════════════════════════════════════
    const padNotes: MidiNote[] = [];

    const chordCm = [C4, Eb4, G4];
    const chordAb = [Ab3, C4, Eb4];
    const chordFm = [F4, Ab4, C5];
    const chordBbMaj = [Bb3, F4, Bb4];
    const chordGmaj = [G3, Bb3, G4];
    // Verse: Cm | Cm | Ab | Ab (4-bar cycle)
    const verseChords = [chordCm, chordCm, chordAb, chordAb];
    // Chorus: Cm | Cm | Ab | Fm (4-bar cycle)
    const chorusChords = [chordCm, chordCm, chordAb, chordFm];
    // Bridge: Cm | Cm | Ab | Ab | Bb | Bb | G | G
    const bridgeChords = [chordCm, chordCm, chordAb, chordAb, chordBbMaj, chordBbMaj, chordGmaj, chordGmaj];

    function addPadChord(pitches: number[], start: number, dur: number, vel: number) {
        for (const p of pitches) {
            padNotes.push(note(p, start, dur, hv(vel, 4)));
        }
    }

    // Verse sections: Cm - Ab vamp
    const verseSections: [number, number][] = [
        [S.verse1, S.preChorus1],
        [S.verse2, S.preChorus2],
    ];
    for (const [vs, ve] of verseSections) {
        let ci = 0;
        for (let b = vs; b < ve; b += 4) {
            addPadChord(verseChords[ci % verseChords.length]!, b, 3.8, 65);
            ci++;
        }
    }

    // Pre-chorus: same vamp, slightly louder
    const preChorusSections: [number, number][] = [
        [S.preChorus1, S.chorus1],
        [S.preChorus2, S.chorus2],
    ];
    for (const [ps, pe] of preChorusSections) {
        let ci = 0;
        for (let b = ps; b < pe; b += 4) {
            addPadChord(verseChords[ci % verseChords.length]!, b, 3.8, 70);
            ci++;
        }
    }

    // Chorus sections: alternating chords with Fm
    const chorusSections: [number, number][] = [
        [S.chorus1, S.verse2],
        [S.chorus2, S.bridge],
        [S.finalChorus, S.outro],
    ];
    for (const [cs, ce] of chorusSections) {
        let ci = 0;
        for (let b = cs; b < ce; b += 4) {
            addPadChord(chorusChords[ci % chorusChords.length]!, b, 3.8, 72);
            ci++;
        }
    }

    // Bridge: Cm-Ab-Bb-G progression, longer sustains
    {
        let ci = 0;
        for (let b = S.bridge; b < S.finalChorus; b += 4) {
            addPadChord(bridgeChords[ci % bridgeChords.length]!, b, 3.8, 60);
            ci++;
        }
    }

    // Outro: fading Cm-Ab
    {
        let ci = 0;
        for (let b = S.outro; b < S.outro + 48 && b < TB; b += 4) {
            addPadChord(verseChords[ci % verseChords.length]!, b, 3.8, Math.max(30, 60 - (b - S.outro)));
            ci++;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 4. LEAD SYNTH — Vocal melody in C minor
    // The melody sits in the C4-Eb5 range. Verses center on C5 and Bb4,
    // occasionally dropping to G4 or rising to Eb5. Speech-like rhythm,
    // syncopated and swung — NOT straight eighth notes.
    // ══════════════════════════════════════════════════════════════════════
    const leadNotes: MidiNote[] = [];

    // Helper to place a melodic phrase starting at a given beat
    function addPhrase(notes: [number, number, number][], startBeat: number, velOffset = 0) {
        for (const [offset, pitch, dur] of notes) {
            leadNotes.push(note(pitch, startBeat + offset, dur, hv(80 + velOffset, 5)));
        }
    }

    // Verse melody — 16 beats (4 bars)
    // Opening: starts on C5, stays around C5-Bb4, descends to G4
    const verseA: [number, number, number][] = [
        [0, C5, 1.0],
        [1.5, C5, 0.5],
        [2.5, C5, 0.5],
        [3.5, Bb4, 0.75],
        [4.5, Bb4, 0.75],
        [5.5, G4, 1.0],
        [7, G4, 0.75],
        // Answering phrase: rises from G4 through Bb4 to C5
        [8, G4, 0.5],
        [9, Bb4, 0.5],
        [10, Bb4, 0.75],
        [11, C5, 1.0],
        [12.5, Bb4, 0.75],
        [13.5, G4, 0.5],
        [14.5, G4, 1.5],
    ];

    // Second half of verse — more rhythmic, insistent
    const verseB: [number, number, number][] = [
        [0, C5, 0.5],
        [0.75, C5, 0.5],
        [1.5, C5, 0.5],
        [2.25, Bb4, 0.5],
        [3, Bb4, 0.75],
        [4, G4, 0.5],
        [5, Bb4, 0.5],
        [6, G4, 1.75],
        // Conclusive phrase
        [8, G4, 0.5],
        [9, Bb4, 0.5],
        [10, C5, 0.5],
        [11, Eb5, 0.75],
        [12, C5, 0.5],
        [13, Bb4, 0.75],
        [14, G4, 0.75],
        [15, G4, 0.75],
    ];

    // Pre-chorus — more insistent, repeated notes on C5 and Bb4
    const preChorusPhrase: [number, number, number][] = [
        [0, C5, 0.5],
        [0.75, C5, 0.5],
        [1.5, Bb4, 0.5],
        [2.25, C5, 0.5],
        [3, C5, 0.75],
        [4, Bb4, 0.5],
        [5, Bb4, 0.5],
        [6, C5, 1.5],
        [8, C5, 0.5],
        [8.75, C5, 0.5],
        [9.5, Bb4, 0.5],
        [10.5, Bb4, 0.5],
        [11.5, G4, 0.75],
        [12.5, Bb4, 0.75],
        [14, C5, 1.5],
    ];

    // Chorus melody — similar range but more rhythmic variation
    const chorusPhrase: [number, number, number][] = [
        [0, Eb5, 0.75],
        [1, C5, 0.5],
        [2, Bb4, 0.5],
        [3, C5, 0.5],
        [4, Bb4, 0.75],
        [5.5, G4, 1.5],
        // Second half — variation
        [8, Eb5, 0.75],
        [9, C5, 0.5],
        [10, Bb4, 0.5],
        [11, Bb4, 0.5],
        [12, G4, 0.5],
        [13, Bb4, 0.5],
        [14, C5, 0.5],
        [15, G4, 1.5],
    ];

    // ── Pre-chorus 1 (melody enters here)
    addPhrase(preChorusPhrase, S.preChorus1, 5);

    // ── Chorus 1
    addPhrase(chorusPhrase, S.chorus1, 10);
    addPhrase(chorusPhrase, S.chorus1 + 16, 12);

    // ── Verse 2 (melody in verse 2)
    addPhrase(verseA, S.verse2, 2);
    addPhrase(verseB, S.verse2 + 16, 4);

    // ── Pre-chorus 2
    addPhrase(preChorusPhrase, S.preChorus2, 7);

    // ── Chorus 2
    addPhrase(chorusPhrase, S.chorus2, 12);
    addPhrase(chorusPhrase, S.chorus2 + 16, 15);

    // ── Bridge — sparse, haunting fragments
    leadNotes.push(note(C5, S.bridge + 8, 4, 70));
    leadNotes.push(note(G4, S.bridge + 16, 4, 65));
    leadNotes.push(note(Bb4, S.bridge + 22, 3, 68));
    leadNotes.push(note(G4, S.bridge + 28, 3, 62));

    // ── Final Chorus — maximum intensity
    addPhrase(chorusPhrase, S.finalChorus, 18);
    addPhrase(chorusPhrase, S.finalChorus + 16, 18);

    // ── Outro — fragments fading
    leadNotes.push(note(C5, S.outro + 4, 3, 60));
    leadNotes.push(note(G4, S.outro + 12, 4, 50));
    leadNotes.push(note(C5, S.outro + 24, 8, 35));

    // ══════════════════════════════════════════════════════════════════════
    // 5. BRASS STABS — Staccato Cm chord hits during choruses
    // Short punchy hits on downbeats and syncopated positions
    // ══════════════════════════════════════════════════════════════════════
    const brassNotes: MidiNote[] = [];
    const brassChordCm = [C4, Eb4, G4]; // Cm triad stab

    function addBrassStab(start: number, vel: number, dur = 0.3) {
        for (const p of brassChordCm) {
            brassNotes.push(note(p, start, dur, hv(vel, 4)));
        }
    }

    // Chorus accents — very sparse, just on downbeats of every other bar.
    // These are gentle chord punctuation, NOT aggressive brass stabs.
    // The original song doesn't have distinct stabs — this just adds
    // a subtle rhythmic accent layer during choruses.
    for (let b = S.chorus1; b < S.verse2; b += 8) {
        addBrassStab(b, 55, 0.5);
    }
    for (let b = S.chorus2; b < S.bridge; b += 8) {
        addBrassStab(b, 58, 0.5);
    }
    for (let b = S.finalChorus; b < S.outro; b += 8) {
        addBrassStab(b, 62, 0.5);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 6. DRUMS — Toaster kit with per-pad clips
    // Pad 0 = Kick (36), Pad 1 = Snare/Clap (37), Pad 2 = Closed HH (38), Pad 3 = Open HH (39)
    // ══════════════════════════════════════════════════════════════════════
    const toasterSegLabels = [
        'Intro',
        'Verse 1',
        'Pre-Ch 1',
        'Chorus 1',
        'Verse 2',
        'Pre-Ch 2',
        'Chorus 2',
        'Bridge',
        'Final Chorus',
        'Outro',
    ] as const;
    const toasterSegRanges: readonly [number, number][] = [
        [S.intro, S.verse1],
        [S.verse1, S.preChorus1],
        [S.preChorus1, S.chorus1],
        [S.chorus1, S.verse2],
        [S.verse2, S.preChorus2],
        [S.preChorus2, S.chorus2],
        [S.chorus2, S.bridge],
        [S.bridge, S.finalChorus],
        [S.finalChorus, S.outro],
        [S.outro, S.end],
    ];

    const toasterSegmentIndex = (absBeat: number): number => {
        for (let i = toasterSegRanges.length - 1; i >= 0; i--) {
            if (absBeat >= toasterSegRanges[i]![0]) {return i;}
        }
        return 0;
    };

    const padSegNotes: MidiNote[][][] = Array.from({ length: 16 }, () => toasterSegRanges.map(() => [] as MidiNote[]));

    const pushToast = (pad: number, absBeat: number, vel: number, dur = 0.12) => {
        const si = toasterSegmentIndex(absBeat);
        const [segStart, segEnd] = toasterSegRanges[si]!;
        if (absBeat < segStart || absBeat >= segEnd) {return;}
        const rel = absBeat - segStart;
        padSegNotes[pad]![si]!.push(note(36 + pad, rel, dur, vel));
    };

    // Drums enter at verse 1 (beat 32), build throughout
    // Kick: beats 1 and 3 (half-time feel, NOT 4-on-the-floor)
    for (let b = S.verse1; b < TB; b += 1) {
        if (b >= S.outro + 48) {break;} // fade out drums
        const posInBar = b % 4;
        if (posInBar !== 0 && posInBar !== 2) {continue;} // beats 1 and 3 only
        const isBridge = b >= S.bridge && b < S.finalChorus;
        // Bridge: only downbeat (beat 1)
        if (isBridge && posInBar !== 0) {continue;}
        const isChorus =
            (b >= S.chorus1 && b < S.verse2) || (b >= S.chorus2 && b < S.bridge) || (b >= S.finalChorus && b < S.outro);
        const vel = isChorus ? hv(100, 4) : hv(88, 4);
        pushToast(0, b, vel, 0.15);
    }

    // Snare/Clap: beats 2 and 4 of each bar
    for (let b = S.verse1; b < TB; b += 1) {
        if (b >= S.outro + 48) {break;}
        const posInBar = b % 4;
        if (posInBar !== 1 && posInBar !== 3) {continue;}
        const isBridge = b >= S.bridge && b < S.finalChorus;
        if (isBridge && posInBar !== 3) {continue;} // half-time snare in bridge
        const isChorus =
            (b >= S.chorus1 && b < S.verse2) || (b >= S.chorus2 && b < S.bridge) || (b >= S.finalChorus && b < S.outro);
        const vel = isChorus ? hv(105, 4) : hv(90, 5);
        pushToast(1, b, vel, 0.12);
    }

    // Closed Hi-hat: 8th notes
    for (let b = S.verse1; b < TB; b += 0.5) {
        if (b >= S.outro + 48) {break;}
        const isBridge = b >= S.bridge && b < S.finalChorus;
        if (isBridge && Math.floor(b * 2) % 4 !== 0) {continue;} // sparse in bridge
        // Skip where open hat plays (upbeats in choruses)
        const isUpbeat = (b * 2) % 2 === 1;
        const isChorus =
            (b >= S.chorus1 && b < S.verse2) || (b >= S.chorus2 && b < S.bridge) || (b >= S.finalChorus && b < S.outro);
        if (isChorus && isUpbeat && Math.floor(b) % 2 === 0) {continue;} // open hat takes over

        const vel = isUpbeat ? hv(60, 5) : hv(75, 5);
        pushToast(2, b, vel, 0.06);
    }

    // Open Hi-hat: upbeats during choruses
    for (let b = S.chorus1; b < TB; b += 0.5) {
        if (b >= S.outro + 32) {break;}
        const isChorus =
            (b >= S.chorus1 && b < S.verse2) || (b >= S.chorus2 && b < S.bridge) || (b >= S.finalChorus && b < S.outro);
        if (!isChorus) {continue;}
        const isUpbeat = (b * 2) % 2 === 1;
        if (!isUpbeat) {continue;}
        if (Math.floor(b) % 2 !== 0) {continue;} // every other upbeat
        pushToast(3, b, hv(72, 5), 0.2);
    }

    // Sort and create clips
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
            if (arr.length === 0) {continue;}
            const [st, en] = toasterSegRanges[s]!;
            const padName = DEFAULT_PAD_NAMES[padIdx] ?? `Pad ${padIdx + 1}`;
            const c = createMidiClip(t.id, `${padName} - ${toasterSegLabels[s]}`, st, en, t.color);
            list.push(c);
            toasterNotesByClipId[c.id] = arr;
        }
        toasterTrackClips.push(list);
    }

    // ══════════════════════════════════════════════════════════════════════
    // WIRE UP CLIPS TO TRACKS
    // ══════════════════════════════════════════════════════════════════════
    const allMidiTracks = [tRiffR, tRiffL, tBass, tPad, tLead, tBrass, ...toasterPadTracks];
    for (const t of allMidiTracks) {
        t.clips = [];
    }

    tRiffR.clips = [cRiffR];
    tRiffL.clips = [cRiffL];
    tBass.clips = [cBass];
    tPad.clips = [cPad];
    tLead.clips = [cLead];
    tBrass.clips = [cBrass];
    toasterPadTracks.forEach((t, i) => {
        t.clips = toasterTrackClips[i] ?? [];
    });

    // ══════════════════════════════════════════════════════════════════════
    // TRACK LIST
    // ══════════════════════════════════════════════════════════════════════
    const tracks = [
        masterTrack,
        synthFolder,
        tRiffR,
        tRiffL,
        tBass,
        tPad,
        tLead,
        tBrass,
        toasterFolder,
        ...toasterPadTracks,
    ];

    trackStore.set({ tracks, selectedTrackId: tRiffR.id });

    // ══════════════════════════════════════════════════════════════════════
    // MIDI STORE — note data per clip
    // ══════════════════════════════════════════════════════════════════════
    const notesByClipId: Record<string, MidiNote[]> = {
        [cRiffR.id]: riffRNotes,
        [cRiffL.id]: riffLNotes,
        [cBass.id]: bassNotes,
        [cPad.id]: padNotes,
        [cLead.id]: leadNotes,
        [cBrass.id]: brassNotes,
    };
    Object.assign(notesByClipId, toasterNotesByClipId);

    midiStore.set({
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    // ══════════════════════════════════════════════════════════════════════
    // TRANSPORT
    // ══════════════════════════════════════════════════════════════════════
    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ══════════════════════════════════════════════════════════════════════
    // AUTOMATION — gain, filter, reverb curves per section
    // ══════════════════════════════════════════════════════════════════════
    const mkLane = (trackId: string, param: string, label: string, min: number, max: number) =>
        createAutomationLane(trackId, param, label, min, max);

    const riffGainPoints = [
        { beat: 0, value: 0.6, curve: 'linear' as const, tension: 0 },
        { beat: S.verse1, value: 0.7, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.chorus1, value: 0.85, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.verse2, value: 0.7, curve: 'linear' as const, tension: 0 },
        { beat: S.chorus2, value: 0.85, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.bridge, value: 0.55, curve: 'smooth' as const, tension: 0.35 },
        { beat: S.finalChorus, value: 0.9, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.outro, value: 0.7, curve: 'linear' as const, tension: 0 },
        { beat: S.outro + 48, value: 0.15, curve: 'smooth' as const, tension: 0.4 },
        { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
    ];
    const riffCutoffPoints = [
        { beat: 0, value: 2000, curve: 'linear' as const, tension: 0 },
        { beat: S.verse1, value: 2800, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.chorus1, value: 5500, curve: 'smooth' as const, tension: 0.35 },
        { beat: S.verse2, value: 2800, curve: 'linear' as const, tension: 0 },
        { beat: S.chorus2, value: 5500, curve: 'smooth' as const, tension: 0.35 },
        { beat: S.bridge, value: 1200, curve: 'smooth' as const, tension: 0.4 },
        { beat: S.bridge + 24, value: 2000, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.finalChorus - 8, value: 3000, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.finalChorus, value: 6500, curve: 'smooth' as const, tension: 0.3 },
        { beat: S.outro, value: 3000, curve: 'linear' as const, tension: 0 },
        { beat: TB, value: 800, curve: 'smooth' as const, tension: 0.4 },
    ];

    const lanes = [
        // ── Synth Riff R gain ───────────────────────────────────────────────
        Object.assign(mkLane(tRiffR.id, 'gain', 'Riff R level', 0, 1), {
            points: [...riffGainPoints],
        }),
        // ── Synth Riff L gain (same curve) ──────────────────────────────────
        Object.assign(mkLane(tRiffL.id, 'gain', 'Riff L level', 0, 1), {
            points: [...riffGainPoints],
        }),

        // ── Synth Riff R filter cutoff ──────────────────────────────────────
        Object.assign(mkLane(tRiffR.id, 'filterCutoff', 'Riff R cutoff', 400, 8000), {
            points: [...riffCutoffPoints],
        }),
        // ── Synth Riff L filter cutoff (same curve) ─────────────────────────
        Object.assign(mkLane(tRiffL.id, 'filterCutoff', 'Riff L cutoff', 400, 8000), {
            points: [...riffCutoffPoints],
        }),

        // ── Bass gain: enters at verse, louder at chorus ─────────────────
        Object.assign(mkLane(tBass.id, 'gain', 'Bass level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1 + 4, value: 0.35, curve: 'smooth' as const, tension: 0.35 },
                { beat: S.chorus1, value: 0.45, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2, value: 0.35, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: 0.45, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: 0.2, curve: 'smooth' as const, tension: 0.35 },
                { beat: S.finalChorus, value: 0.5, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro, value: 0.3, curve: 'linear' as const, tension: 0 },
                { beat: S.outro + 48, value: 0, curve: 'smooth' as const, tension: 0.4 },
                { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Pad gain: swells in at verse, bigger at chorus ───────────────
        Object.assign(mkLane(tPad.id, 'gain', 'Pad level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1 + 8, value: 0.45, curve: 'smooth' as const, tension: 0.4 },
                { beat: S.chorus1, value: 0.65, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2, value: 0.45, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: 0.65, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: 0.55, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge + 24, value: 0.7, curve: 'smooth' as const, tension: 0.35 },
                { beat: S.finalChorus, value: 0.72, curve: 'linear' as const, tension: 0 },
                { beat: S.outro, value: 0.5, curve: 'linear' as const, tension: 0 },
                { beat: S.outro + 56, value: 0, curve: 'smooth' as const, tension: 0.4 },
                { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Pad reverb: increases during bridge ──────────────────────────
        Object.assign(mkLane(tPad.id, 'rev-mix', 'Pad reverb', 0, 1), {
            points: [
                { beat: S.verse1, value: 0.35, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus1, value: 0.5, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: 0.55, curve: 'linear' as const, tension: 0 },
                { beat: S.bridge + 32, value: 0.75, curve: 'smooth' as const, tension: 0.35 },
                { beat: S.finalChorus, value: 0.5, curve: 'linear' as const, tension: 0 },
                { beat: TB, value: 0.4, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Lead gain: appears at pre-chorus, disappears between sections ─
        Object.assign(mkLane(tLead.id, 'gain', 'Lead level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.preChorus1 - 2, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.preChorus1, value: 0.65, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.chorus1, value: 0.78, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2 - 2, value: 0.78, curve: 'linear' as const, tension: 0 },
                { beat: S.verse2, value: 0.15, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2 + 2, value: 0.68, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.chorus2, value: 0.82, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge - 2, value: 0.82, curve: 'linear' as const, tension: 0 },
                { beat: S.bridge, value: 0.2, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge + 16, value: 0.35, curve: 'linear' as const, tension: 0 },
                { beat: S.finalChorus - 4, value: 0.2, curve: 'linear' as const, tension: 0 },
                { beat: S.finalChorus, value: 0.88, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro, value: 0.55, curve: 'linear' as const, tension: 0 },
                { beat: S.outro + 32, value: 0, curve: 'smooth' as const, tension: 0.4 },
                { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Accent gain: subtle chord punctuation during choruses ─────────
        Object.assign(mkLane(tBrass.id, 'gain', 'Accent level', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus1 - 1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus1, value: 0.25, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2 - 1, value: 0.25, curve: 'linear' as const, tension: 0 },
                { beat: S.verse2, value: 0, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.chorus2 - 1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: 0.3, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge - 1, value: 0.3, curve: 'linear' as const, tension: 0 },
                { beat: S.bridge, value: 0, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.finalChorus - 1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.finalChorus, value: 0.35, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro - 1, value: 0.35, curve: 'linear' as const, tension: 0 },
                { beat: S.outro, value: 0, curve: 'smooth' as const, tension: 0.3 },
                { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Drums (Toaster folder) gain: builds throughout ───────────────
        Object.assign(mkLane(toasterFolder.id, 'gain', 'Drum bus', 0, 1), {
            points: [
                { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1 - 1, value: 0, curve: 'linear' as const, tension: 0 },
                { beat: S.verse1, value: 0.6, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.chorus1, value: 0.78, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2, value: 0.65, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: 0.82, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: 0.45, curve: 'smooth' as const, tension: 0.35 },
                { beat: S.finalChorus, value: 0.88, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro, value: 0.6, curve: 'linear' as const, tension: 0 },
                { beat: S.outro + 48, value: 0, curve: 'smooth' as const, tension: 0.4 },
                { beat: TB, value: 0, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Master stereo width: wider at chorus ─────────────────────────
        Object.assign(mkLane(masterTrack.id, 'width-amount', 'Master width', 1, 1.3), {
            points: [
                { beat: 0, value: 1.05, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus1, value: 1.18, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2, value: 1.08, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: 1.2, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: 1.05, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.finalChorus, value: 1.22, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro, value: 1.1, curve: 'linear' as const, tension: 0 },
                { beat: TB, value: 1.05, curve: 'linear' as const, tension: 0 },
            ],
        }),

        // ── Master compressor threshold: more compression at chorus ──────
        Object.assign(mkLane(masterTrack.id, 'comp-threshold', 'Glue threshold', -24, 0), {
            points: [
                { beat: 0, value: -10, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus1, value: -14, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.verse2, value: -10, curve: 'linear' as const, tension: 0 },
                { beat: S.chorus2, value: -15, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.bridge, value: -8, curve: 'linear' as const, tension: 0 },
                { beat: S.finalChorus, value: -16, curve: 'smooth' as const, tension: 0.3 },
                { beat: S.outro, value: -10, curve: 'linear' as const, tension: 0 },
                { beat: TB, value: -8, curve: 'linear' as const, tension: 0 },
            ],
        }),
    ];

    automationStore.set({ lanes });

    // ══════════════════════════════════════════════════════════════════════
    // MARKERS — section boundaries
    // ══════════════════════════════════════════════════════════════════════
    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: S.intro, name: 'Intro', color: 'oklch(0.40 0.08 260)' },
            { id: crypto.randomUUID(), beat: S.verse1, name: 'Verse 1', color: 'oklch(0.40 0.07 140)' },
            { id: crypto.randomUUID(), beat: S.preChorus1, name: 'Pre-Chorus 1', color: 'oklch(0.41 0.08 90)' },
            { id: crypto.randomUUID(), beat: S.chorus1, name: 'Chorus 1', color: 'oklch(0.42 0.09 30)' },
            { id: crypto.randomUUID(), beat: S.verse2, name: 'Verse 2', color: 'oklch(0.40 0.07 140)' },
            { id: crypto.randomUUID(), beat: S.preChorus2, name: 'Pre-Chorus 2', color: 'oklch(0.41 0.08 90)' },
            { id: crypto.randomUUID(), beat: S.chorus2, name: 'Chorus 2', color: 'oklch(0.42 0.09 30)' },
            { id: crypto.randomUUID(), beat: S.bridge, name: 'Bridge', color: 'oklch(0.38 0.08 280)' },
            { id: crypto.randomUUID(), beat: S.finalChorus, name: 'Final Chorus', color: 'oklch(0.44 0.10 20)' },
            { id: crypto.randomUUID(), beat: S.outro, name: 'Outro', color: 'oklch(0.38 0.06 240)' },
        ],
        sections: [
            {
                id: crypto.randomUUID(),
                startBeat: S.intro,
                endBeat: S.verse1,
                name: 'Intro',
                color: 'oklch(0.40 0.08 260)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.verse1,
                endBeat: S.preChorus1,
                name: 'Verse 1',
                color: 'oklch(0.40 0.07 140)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.preChorus1,
                endBeat: S.chorus1,
                name: 'Pre-Chorus 1',
                color: 'oklch(0.41 0.08 90)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.chorus1,
                endBeat: S.verse2,
                name: 'Chorus 1',
                color: 'oklch(0.42 0.09 30)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.verse2,
                endBeat: S.preChorus2,
                name: 'Verse 2',
                color: 'oklch(0.40 0.07 140)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.preChorus2,
                endBeat: S.chorus2,
                name: 'Pre-Chorus 2',
                color: 'oklch(0.41 0.08 90)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.chorus2,
                endBeat: S.bridge,
                name: 'Chorus 2',
                color: 'oklch(0.42 0.09 30)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.bridge,
                endBeat: S.finalChorus,
                name: 'Bridge',
                color: 'oklch(0.38 0.08 280)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.finalChorus,
                endBeat: S.outro,
                name: 'Final Chorus',
                color: 'oklch(0.44 0.10 20)',
            },
            {
                id: crypto.randomUUID(),
                startBeat: S.outro,
                endBeat: S.end,
                name: 'Outro',
                color: 'oklch(0.38 0.06 240)',
            },
        ],
    });

    // ══════════════════════════════════════════════════════════════════════
    // SYNC & AUDIO ENGINE BOOTSTRAP
    // ══════════════════════════════════════════════════════════════════════
    syncArrangement(tracks);

    const { addDeviceToStrip, updateDeviceParam } = await import('#/modules/AudioEngine/useCases');
    const { ensureTrackStrip, setTrackGain, setTrackPan, setTrackOutput, setTrackMute } =
        await import('#/modules/AudioEngine/useCases');

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

    const { ensureTrackStrips } = await import('#/modules/Transport/useCases');
    ensureTrackStrips();

    const { waitForDevices } = await import('#/modules/AudioEngine/useCases');
    await waitForDevices();

    projectStore.set({
        name: 'Sweet Creams (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
        initialized: true,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, i) => 440 * Math.pow(2, (i - 69) / 12)),
        },
    });
}
