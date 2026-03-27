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
export async function demo2_ElectronicBeat(): Promise<void> {
    const bpm = 142;
    const TB = 720;

    // A minor chord cycle (16 beats each): Am → F → C → G
    const BASS_ROOTS = [33, 29, 36, 31]; // A1 F1 C2 G1
    const CHORD_TONES: number[][] = [
        [57, 60, 64, 67], // Am7: A3 C4 E4 G4
        [53, 57, 60, 64], // Fmaj7: F3 A3 C4 E4
        [60, 64, 67, 71], // Cmaj7: C4 E4 G4 B4
        [55, 59, 62, 66], // G7: G3 B3 D4 F#4
    ];
    const PAD_TONES: number[][] = [
        [45, 48, 52], // Am: A2 C3 E3
        [41, 45, 48], // F:  F2 A2 C3
        [48, 52, 55], // C:  C3 E3 G3
        [43, 47, 50], // G:  G2 B2 D3
    ];

    const ci = (beat: number) => Math.floor(beat / 16) % 4;
    const br = (beat: number) => BASS_ROOTS[ci(beat)]!;
    const ct = (beat: number) => CHORD_TONES[ci(beat)]!;
    const hv = (base: number, r = 6) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));

    // Section helpers
    const R = (b: number, lo: number, hi: number) => b >= lo && b < hi;

    // ── TRACKS ───────────────────────────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    const drumFolder = createTrack({ name: 'Drums', kind: 'folder' });
    const bassFolder = createTrack({ name: 'Bass', kind: 'folder' });
    const synthFolder = createTrack({ name: 'Synths', kind: 'folder' });
    const fxFolder = createTrack({ name: 'FX', kind: 'folder' });

    const drumTrack = createTrack({ name: 'Drums 808', kind: 'midi', parentId: drumFolder.id });
    const percTrack = createTrack({ name: 'Percussion', kind: 'midi', parentId: drumFolder.id });
    const acidTrack = createTrack({ name: 'Acid Bass', kind: 'midi', parentId: bassFolder.id });
    const subTrack = createTrack({ name: 'Sub Bass', kind: 'midi', parentId: bassFolder.id });
    const padTrack = createTrack({ name: 'Dark Pad', kind: 'midi', parentId: synthFolder.id });
    const ssTrack = createTrack({ name: 'Supersaw', kind: 'midi', parentId: synthFolder.id });
    const arpTrack = createTrack({ name: 'Arp Synth', kind: 'midi', parentId: synthFolder.id });
    const leadTrack = createTrack({ name: 'Trance Lead', kind: 'midi', parentId: synthFolder.id });
    const lead2Track = createTrack({ name: 'Formant Lead', kind: 'midi', parentId: synthFolder.id });
    const sweepTrack = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const stabTrack = createTrack({ name: 'Stab', kind: 'midi', parentId: fxFolder.id });

    applyPreset(drumTrack, 'factory-drumkit-808');
    applyPreset(percTrack, 'factory-drumkit-808');
    applyPreset(acidTrack, 'factory-bass-acid');
    applyPreset(subTrack, 'factory-bass-sub');
    applyPreset(padTrack, 'factory-pad-dark');
    applyPreset(ssTrack, 'factory-synth-supersaw');
    applyPreset(arpTrack, 'factory-synth-arp');
    applyPreset(leadTrack, 'factory-lead-detuned');
    applyPreset(lead2Track, 'factory-lead-formant');
    applyPreset(sweepTrack, 'factory-fx-noise-sweep');
    applyPreset(stabTrack, 'factory-fx-stab');

    arpTrack.pan = -15;
    lead2Track.pan = 20;
    ssTrack.pan = 10;
    percTrack.pan = -10;
    subTrack.gain = 0.6;

    // ── CLIPS ────────────────────────────────────────────────────────────
    const drumClip = createMidiClip(drumTrack.id, 'Main Drums', 0, TB, drumTrack.color);
    const percClip = createMidiClip(percTrack.id, 'Perc Accents', 64, TB, percTrack.color);
    const acidClip = createMidiClip(acidTrack.id, 'Acid Line', 64, TB, acidTrack.color);
    const subClip = createMidiClip(subTrack.id, 'Sub Foundation', 0, TB, subTrack.color);
    const padClip = createMidiClip(padTrack.id, 'Dark Atmosphere', 0, TB, padTrack.color);
    const ssClip = createMidiClip(ssTrack.id, 'Supersaw Stabs', 128, 576, ssTrack.color);
    const arpClip = createMidiClip(arpTrack.id, 'Psytrance Arp', 64, TB, arpTrack.color);
    const leadClip = createMidiClip(leadTrack.id, 'Lead Melody', 128, 576, leadTrack.color);
    const lead2Clip = createMidiClip(lead2Track.id, 'Alt Melody', 320, 512, lead2Track.color);
    const sweepClip = createMidiClip(sweepTrack.id, 'Sweeps', 48, TB, sweepTrack.color);
    const stabClip = createMidiClip(stabTrack.id, 'Trance Stabs', 128, 576, stabTrack.color);

    drumTrack.clips = [drumClip];
    percTrack.clips = [percClip];
    acidTrack.clips = [acidClip];
    subTrack.clips = [subClip];
    padTrack.clips = [padClip];
    ssTrack.clips = [ssClip];
    arpTrack.clips = [arpClip];
    leadTrack.clips = [leadClip];
    lead2Track.clips = [lead2Clip];
    sweepTrack.clips = [sweepClip];
    stabTrack.clips = [stabClip];

    // ── NOTE ARRAYS ──────────────────────────────────────────────────────
    const dn: MidiNote[] = []; // drums
    const pn: MidiNote[] = []; // percussion
    const an: MidiNote[] = []; // acid
    const sn: MidiNote[] = []; // sub
    const pdn: MidiNote[] = []; // pad
    const ssn: MidiNote[] = []; // supersaw
    const arn: MidiNote[] = []; // arp
    const ln: MidiNote[] = []; // lead
    const l2n: MidiNote[] = []; // lead2
    const swn: MidiNote[] = []; // sweep
    const stn: MidiNote[] = []; // stab

    // ── DRUMS (step = 16th note) ─────────────────────────────────────────
    const isDrop = (b: number) => R(b, 128, 256) || R(b, 320, 512) || R(b, 576, TB);
    const isBuild = (b: number) => R(b, 64, 128);
    const isBD = (b: number) => R(b, 256, 320) || R(b, 512, 576);

    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) break;
        const p = b % 4; // position in bar
        const bar = Math.floor(b / 4);

        // Kick: 4-on-floor (not in breakdowns)
        if (p % 1 === 0 && !isBD(b)) {
            let v = R(b, 0, 64) ? hv(90) : isBuild(b) ? hv(100) : isDrop(b) ? hv(115) : 0;
            if (b >= TB - 32) v = Math.round(v * Math.max(0, 1 - (b - (TB - 32)) / 32));
            if (v > 0) dn.push(note(36, b, 0.5, v));
        }
        // Extra syncopated kicks in drops B and chaos
        if ((R(b, 320, 512) || R(b, 576, TB)) && (p === 0.75 || p === 2.75) && bar % 2 === 0) {
            dn.push(note(36, b, 0.25, hv(80)));
        }

        // Clap on 1,3 of each bar
        if ((p === 1 || p === 3) && (isDrop(b) || isBuild(b))) {
            dn.push(note(39, b, 0.25, hv(100)));
            if (isDrop(b)) dn.push(note(38, b, 0.25, hv(75))); // snare layer
        }

        // Closed HH: 16ths in drops, 8ths in build
        if (isDrop(b) && p % 0.25 === 0) {
            const accent = p % 1 === 0 ? 80 : p % 0.5 === 0 ? 55 : 35;
            dn.push(note(42, b, 0.125, hv(accent)));
        } else if (isBuild(b) && p % 0.5 === 0) {
            dn.push(note(42, b, 0.125, hv(60)));
        }

        // Open HH accent every 8 beats in drops
        if (isDrop(b) && p === 0.5 && bar % 2 === 0) {
            dn.push(note(46, b, 0.5, hv(65)));
        }

        // Breakdown textures
        if (isBD(b)) {
            if (p === 2 && bar % 2 === 0) dn.push(note(37, b, 0.125, hv(50))); // rimshot
            if (R(b, 512, 576) && p % 0.5 === 0) dn.push(note(70, b, 0.1, hv(25))); // maracas
        }

        // Tom fills before section changes (last 4 beats of every 64-beat block)
        if (isDrop(b) && b % 64 >= 60 && p % 0.5 === 0) {
            const tom = p < 2 ? 43 : p < 3 ? 47 : 50;
            dn.push(note(tom, b, 0.25, hv(80)));
        }

        // Intro rimshot offbeats (beats 32-64)
        if (R(b, 32, 64) && (p === 0.5 || p === 2.5)) {
            dn.push(note(37, b, 0.125, hv(55)));
        }
    }

    // ── PERCUSSION: cowbell, clave, congas ────────────────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB || b < 64) continue;
        const p = b % 4;
        const bar = Math.floor(b / 4);
        if (isDrop(b) && p % 0.5 === 0.25 && bar % 4 < 2) pn.push(note(56, b, 0.1, hv(45))); // cowbell
        if (R(b, 448, 512) && p % 0.25 === 0 && bar % 2 === 1) pn.push(note(75, b, 0.1, hv(40))); // clave
        if (isDrop(b) && bar % 8 >= 6 && p === 1.5) pn.push(note(62, b, 0.15, hv(50))); // conga
    }

    // ── ACID BASS ────────────────────────────────────────────────────────
    // Pattern A: syncopated 16th with octave jumps
    const acidPatA = [
        [0, 0, 0.25], [0.25, 12, 0.125], [0.5, 0, 0.25],
        [1, 0, 0.5], [1.5, -2, 0.25], [1.75, 0, 0.25],
        [2, 7, 0.25], [2.5, 0, 0.5],
        [3, 12, 0.25], [3.5, 7, 0.25], [3.75, 5, 0.25],
    ];
    // Pattern B: more aggressive rapid-fire
    const acidPatB = [
        [0, 0, 0.125], [0.25, 12, 0.125], [0.5, 7, 0.125], [0.75, 12, 0.125],
        [1, 0, 0.25], [1.25, 5, 0.25], [1.5, 7, 0.25], [1.75, 12, 0.25],
        [2, 0, 0.5], [2.5, 5, 0.125], [2.75, 7, 0.125],
        [3, 12, 0.25], [3.25, 0, 0.25], [3.5, 5, 0.5],
    ];

    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || isBD(bs)) continue;
        const root = br(bs);
        const pat = (R(bs, 320, 512) || R(bs, 576, TB)) ? acidPatB : acidPatA;
        const v = isBuild(bs) ? 85 : 105;
        for (const [off, interval, dur] of pat) {
            if (bs + off! >= TB) break;
            an.push(note(root + interval!, bs + off!, dur!, hv(v)));
        }
    }

    // ── SUB BASS ─────────────────────────────────────────────────────────
    for (let beat = 0; beat < TB; beat += 2) {
        if (isBD(beat)) continue;
        const root = br(beat);
        sn.push(note(root, beat, 1.8, hv(85)));
    }

    // ── DARK PAD (sustained chords) ──────────────────────────────────────
    for (let beat = 0; beat < TB; beat += 16) {
        const tones = PAD_TONES[ci(beat)]!;
        const dur = isBD(beat) ? 16 : 15.5;
        const v = isBD(beat) ? 75 : isDrop(beat) ? 55 : R(beat, 0, 64) ? 40 : 60;
        for (const t of tones) pdn.push(note(t, beat, dur, hv(v)));
    }

    // ── SUPERSAW CHORDS (drops only, shorter rhythmic hits) ──────────────
    for (let beat = 128; beat < 576; beat += 4) {
        if (isBD(beat)) continue;
        const tones = ct(beat);
        for (const t of tones) ssn.push(note(t, beat, 0.5, hv(90)));
        // echo on beat 2
        for (const t of tones) ssn.push(note(t, beat + 2, 0.25, hv(70)));
    }

    // ── ARP (16th note cycling through chord tones) ──────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 64 || b >= TB || isBD(b)) continue;
        const tones = ct(b);
        const idx = s % tones.length;
        const octave = Math.floor(s / tones.length) % 2 === 0 ? 0 : 12;
        const v = isDrop(b) ? hv(70) : hv(55);
        arn.push(note(tones[idx]! + octave, b, 0.2, v));
    }

    // ── LEAD MELODY (Drop A phrase, 16-beat phrases) ─────────────────────
    // A minor pentatonic melodies: A4=69 C5=72 D5=74 E5=76 G5=79 A5=81
    const melodyA: [number, number, number][] = [ // [offset, pitch, duration]
        [0, 76, 1.5], [2, 74, 1], [3, 72, 1], [4, 69, 2], [6, 72, 1], [7, 74, 1],
        [8, 76, 1.5], [10, 79, 1], [11, 81, 1], [12, 79, 2], [14, 76, 2],
    ];
    const melodyB: [number, number, number][] = [
        [0, 81, 0.5], [0.5, 79, 0.5], [1, 76, 1], [2, 79, 0.5], [2.5, 81, 1.5],
        [4, 79, 1], [5, 76, 0.5], [5.5, 74, 0.5], [6, 72, 2],
        [8, 74, 1], [9, 76, 1], [10, 79, 2], [12, 81, 2], [14, 79, 2],
    ];
    for (let phrase = 0; phrase < (576 - 128) / 16; phrase++) {
        const start = 128 + phrase * 16;
        if (isBD(start)) continue;
        const mel = R(start, 128, 256) ? melodyA : melodyB;
        for (const [off, pitch, dur] of mel) {
            if (start + off >= 576) break;
            // Transpose melody based on chord root offset from A
            const rootOffset = [0, -4, 3, -2][ci(start)]!; // Am=0, F=-4, C=3, G=-2
            ln.push(note(pitch + rootOffset, start + off, dur, hv(95)));
        }
    }

    // ── FORMANT LEAD (Drop B alt melody) ─────────────────────────────────
    const fMel: [number, number, number][] = [
        [0, 72, 2], [2, 76, 1], [3, 79, 1], [4, 81, 3], [7, 79, 1],
        [8, 76, 2], [10, 74, 1], [11, 72, 1], [12, 69, 4],
    ];
    for (let phrase = 0; phrase < (512 - 320) / 16; phrase++) {
        const start = 320 + phrase * 16;
        if (isBD(start)) continue;
        for (const [off, pitch, dur] of fMel) {
            l2n.push(note(pitch, start + off, dur, hv(85)));
        }
    }

    // ── NOISE SWEEPS (before drops) ──────────────────────────────────────
    const sweepPoints = [48, 112, 304, 560]; // 16 beats before each drop
    for (const sp of sweepPoints) {
        swn.push(note(60, sp, 16, 70));
    }

    // ── STABS (accent hits in drops) ─────────────────────────────────────
    for (let beat = 128; beat < 576; beat += 8) {
        if (isBD(beat)) continue;
        stn.push(note(ct(beat)[0]! + 12, beat, 0.1, hv(100)));
    }

    // ── ASSEMBLE ─────────────────────────────────────────────────────────
    const tracks = [
        masterTrack, drumFolder, drumTrack, percTrack,
        bassFolder, acidTrack, subTrack,
        synthFolder, padTrack, ssTrack, arpTrack, leadTrack, lead2Track,
        fxFolder, sweepTrack, stabTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: leadTrack.id });

    midiStore.set({
        notesByClipId: {
            [drumClip.id]: dn, [percClip.id]: pn,
            [acidClip.id]: an, [subClip.id]: sn,
            [padClip.id]: pdn, [ssClip.id]: ssn,
            [arpClip.id]: arn, [leadClip.id]: ln,
            [lead2Clip.id]: l2n, [sweepClip.id]: swn,
            [stabClip.id]: stn,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION ───────────────────────────────────────────────────────
    const padVol = createAutomationLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVol.points = [
        { beat: 0, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 720, value: 0.1, curve: 'linear', tension: 0 },
    ];
    const arpVol = createAutomationLane(arpTrack.id, 'volume', 'Volume', 0, 1);
    arpVol.points = [
        { beat: 64, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 700, value: 0.0, curve: 'linear', tension: 0 },
    ];
    const ssVol = createAutomationLane(ssTrack.id, 'volume', 'Volume', 0, 1);
    ssVol.points = [
        { beat: 128, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 144, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 248, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 336, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 440, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 448, value: 0.0, curve: 'linear', tension: 0 },
    ];
    const acidVol = createAutomationLane(acidTrack.id, 'volume', 'Volume', 0, 1);
    acidVol.points = [
        { beat: 64, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 576, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 700, value: 0.0, curve: 'linear', tension: 0 },
    ];

    automationStore.set({ lanes: [padVol, arpVol, ssVol, acidVol] });

    // ── MARKERS ──────────────────────────────────────────────────────────
    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: 'oklch(0.35 0.10 280)' },
            { id: crypto.randomUUID(), beat: 64, name: 'Build', color: 'oklch(0.38 0.12 320)' },
            { id: crypto.randomUUID(), beat: 128, name: 'Drop A', color: 'oklch(0.42 0.15 30)' },
            { id: crypto.randomUUID(), beat: 256, name: 'Breakdown', color: 'oklch(0.35 0.08 200)' },
            { id: crypto.randomUUID(), beat: 320, name: 'Drop B', color: 'oklch(0.42 0.15 10)' },
            { id: crypto.randomUUID(), beat: 448, name: 'Chaos', color: 'oklch(0.45 0.18 50)' },
            { id: crypto.randomUUID(), beat: 512, name: 'Breakdown 2', color: 'oklch(0.35 0.08 180)' },
            { id: crypto.randomUUID(), beat: 576, name: 'Final Drop', color: 'oklch(0.42 0.15 0)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 64, name: 'Intro', color: 'oklch(0.35 0.10 280)' },
            { id: crypto.randomUUID(), startBeat: 64, endBeat: 128, name: 'Build', color: 'oklch(0.38 0.12 320)' },
            { id: crypto.randomUUID(), startBeat: 128, endBeat: 256, name: 'Drop A', color: 'oklch(0.42 0.15 30)' },
            { id: crypto.randomUUID(), startBeat: 256, endBeat: 320, name: 'Breakdown', color: 'oklch(0.35 0.08 200)' },
            { id: crypto.randomUUID(), startBeat: 320, endBeat: 448, name: 'Drop B', color: 'oklch(0.42 0.15 10)' },
            { id: crypto.randomUUID(), startBeat: 448, endBeat: 512, name: 'Chaos', color: 'oklch(0.45 0.18 50)' },
            { id: crypto.randomUUID(), startBeat: 512, endBeat: 576, name: 'Breakdown 2', color: 'oklch(0.35 0.08 180)' },
            { id: crypto.randomUUID(), startBeat: 576, endBeat: 720, name: 'Final Drop', color: 'oklch(0.42 0.15 0)' },
        ],
    });

    syncArrangement(tracks);
    projectStore.set({ name: 'Psyloops (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false, loading: false });
}

// ---------------------------------------------------------------------------
// Demo Project 3: Chill Jazz — "Midnight Smoke"
// Key: Eb major / C minor | BPM: 82 | ~4:18 (588 beats)
// Structure: Intro(0-48) → A(48-132) → B(132-216) → Solo(216-300) →
//            Return A(300-384) → Variation(384-492) → Outro(492-588)
// ---------------------------------------------------------------------------

