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
export async function demo3_AcousticSession(): Promise<void> {
    const bpm = 82;
    const TB = 588;

    // Jazz chords in Eb / Cm   (midi notes for voicings)
    // 0: EbMaj7   1: Cm7   2: Fm7   3: Bb7   4: AbMaj7   5: Gm7   6: Dm7b5   7: G7
    const JAZZ_VOICINGS: number[][] = [
        [51, 55, 58, 62],  // EbMaj7: Eb3 G3 Bb3 D4
        [48, 51, 55, 58],  // Cm7:    C3  Eb3 G3 Bb3
        [53, 56, 60, 63],  // Fm7:    F3  Ab3 C4 Eb4
        [46, 50, 53, 56],  // Bb7:    Bb2 D3  F3 Ab3
        [56, 60, 63, 67],  // AbMaj7: Ab3 C4  Eb4 G4
        [55, 58, 62, 65],  // Gm7:    G3  Bb3 D4 F4
        [50, 53, 56, 60],  // Dm7b5:  D3  F3  Ab3 C4
        [43, 47, 50, 53],  // G7:     G2  B2  D3 F3
    ];
    const BASS_ROOTS = [39, 36, 41, 34, 44, 43, 38, 31]; // Eb2, C2, F2, Bb1, Ab2, G2, D2, G1

    // Progressions per section (chord indices, 8 beats each)
    const PROG_A = [0, 2, 3, 0, 1, 5, 2, 3]; // I-ii-V-I vi-iii-ii-V
    const PROG_B = [4, 5, 2, 0, 1, 6, 7, 1]; // IV-iii-ii-I vi-viib5-V/vi-vi
    const PROG_SOLO = [2, 3, 0, 1, 4, 5, 6, 7]; // ii-V-I-vi IV-iii-viib5-V/vi

    const getChordIdx = (beat: number): number => {
        const section = getSec(beat);
        const barInSec = Math.floor((beat - section.start) / 8) % 8;
        return section.prog[barInSec]!;
    };

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
    const hv = (base: number, r = 8) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));

    // ── TRACKS ───────────────────────────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    const rhythmFolder = createTrack({ name: 'Rhythm', kind: 'folder' });
    const bassFolder = createTrack({ name: 'Bass', kind: 'folder' });
    const keysFolder = createTrack({ name: 'Keys', kind: 'folder' });
    const melodyFolder = createTrack({ name: 'Melody', kind: 'folder' });
    const atmosFolder = createTrack({ name: 'Atmosphere', kind: 'folder' });

    const drumTrack = createTrack({ name: 'Jazz Drums', kind: 'midi', parentId: rhythmFolder.id });
    const percTrack = createTrack({ name: 'Percussion', kind: 'midi', parentId: rhythmFolder.id });
    const bassTrack = createTrack({ name: 'Walking Bass', kind: 'midi', parentId: bassFolder.id });
    const subTrack = createTrack({ name: 'Sub Layer', kind: 'midi', parentId: bassFolder.id });
    const rhodesTrack = createTrack({ name: 'Rhodes', kind: 'midi', parentId: keysFolder.id });
    const organTrack = createTrack({ name: 'Organ', kind: 'midi', parentId: keysFolder.id });
    const fluteTrack = createTrack({ name: 'Flute', kind: 'midi', parentId: melodyFolder.id });
    const bellTrack = createTrack({ name: 'Bell', kind: 'midi', parentId: melodyFolder.id });
    const padTrack = createTrack({ name: 'Shimmer Pad', kind: 'midi', parentId: atmosFolder.id });
    const stringsTrack = createTrack({ name: 'Soft Strings', kind: 'midi', parentId: atmosFolder.id });

    applyPreset(drumTrack, 'factory-drumkit-808');
    applyPreset(percTrack, 'factory-drumkit-808');
    applyPreset(bassTrack, 'factory-bass-analog');
    applyPreset(subTrack, 'factory-bass-sub');
    applyPreset(rhodesTrack, 'factory-keys-epiano');
    applyPreset(organTrack, 'factory-keys-organ');
    applyPreset(fluteTrack, 'factory-synth-flute');
    applyPreset(bellTrack, 'factory-keys-bell');
    applyPreset(padTrack, 'factory-pad-shimmer');
    applyPreset(stringsTrack, 'factory-strings-soft');

    rhodesTrack.pan = -15;
    bellTrack.pan = 20;
    organTrack.pan = -10;
    percTrack.pan = 15;
    stringsTrack.gain = 0.5;
    subTrack.gain = 0.4;

    // ── CLIPS ────────────────────────────────────────────────────────────
    const drumClip = createMidiClip(drumTrack.id, 'Jazz Kit', 0, TB, drumTrack.color);
    const percClip = createMidiClip(percTrack.id, 'Latin Perc', 48, TB, percTrack.color);
    const bassClip = createMidiClip(bassTrack.id, 'Walking Bass', 0, TB, bassTrack.color);
    const subClip = createMidiClip(subTrack.id, 'Sub', 0, TB, subTrack.color);
    const rhodesClip = createMidiClip(rhodesTrack.id, 'Rhodes Comping', 0, TB, rhodesTrack.color);
    const organClip = createMidiClip(organTrack.id, 'Organ Pads', 132, 384, organTrack.color);
    const fluteClip = createMidiClip(fluteTrack.id, 'Flute Solo', 216, 384, fluteTrack.color);
    const bellClip = createMidiClip(bellTrack.id, 'Bell Melody', 48, 300, bellTrack.color);
    const padClip = createMidiClip(padTrack.id, 'Shimmer', 0, TB, padTrack.color);
    const stringsClip = createMidiClip(stringsTrack.id, 'Strings', 132, TB, stringsTrack.color);

    drumTrack.clips = [drumClip];
    percTrack.clips = [percClip];
    bassTrack.clips = [bassClip];
    subTrack.clips = [subClip];
    rhodesTrack.clips = [rhodesClip];
    organTrack.clips = [organClip];
    fluteTrack.clips = [fluteClip];
    bellTrack.clips = [bellClip];
    padTrack.clips = [padClip];
    stringsTrack.clips = [stringsClip];

    // ── NOTE ARRAYS ──────────────────────────────────────────────────────
    const dn: MidiNote[] = [];
    const pcn: MidiNote[] = [];
    const bn: MidiNote[] = [];
    const sbn: MidiNote[] = [];
    const rn: MidiNote[] = [];
    const on: MidiNote[] = [];
    const fn: MidiNote[] = [];
    const bln: MidiNote[] = [];
    const pdn: MidiNote[] = [];
    const strn: MidiNote[] = [];

    // ── JAZZ DRUMS ───────────────────────────────────────────────────────
    // Cross-stick (rimshot 37) as snare, closed HH (42) as ride, kick (36) sparse
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) break;
        const p = b % 4;
        const sec = getSec(b);
        const isIntro = sec.name === 'Intro';
        const isOutro = sec.name === 'Outro';

        // "Ride" on closed HH — swing 8ths (on beat + dotted offbeat)
        if (p % 1 === 0) {
            dn.push(note(42, b, 0.3, hv(isIntro ? 40 : 60)));
        }
        if (p % 1 === 0.75) { // swung offbeat
            dn.push(note(42, b, 0.2, hv(isIntro ? 30 : 45)));
        }

        // Cross-stick on 2 and 4 (not intro/outro)
        if ((p === 1 || p === 3) && !isIntro) {
            dn.push(note(37, b, 0.2, hv(isOutro ? 40 : 65)));
        }

        // Kick: beats 1 and 3 of odd bars, beat 1 of even bars + syncopation
        const barInSec = Math.floor((b - sec.start) / 4);
        if (!isIntro) {
            if (p === 0 && barInSec % 2 === 0) dn.push(note(36, b, 0.4, hv(70)));
            if (p === 2.5 && barInSec % 2 === 1) dn.push(note(36, b, 0.3, hv(55))); // syncopated
            if (p === 0 && barInSec % 4 === 2) dn.push(note(36, b, 0.4, hv(65)));
        }

        // Ghost notes (very quiet snare taps at random 16th positions)
        if (!isIntro && !isOutro && p % 0.25 === 0 && Math.random() < 0.08) {
            dn.push(note(38, b, 0.1, hv(25, 5)));
        }
        // Outro fade
        if (isOutro && p === 0 && barInSec % 2 === 0) {
            const fade = Math.max(0, 1 - (b - sec.start) / (sec.end - sec.start));
            if (fade > 0.1) dn.push(note(36, b, 0.4, Math.round(50 * fade)));
        }
    }

    // ── PERCUSSION: clave, congas ────────────────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 48) continue;
        const sec = getSec(bs);
        // Son clave pattern (3-2): hits at 0, 1.5, 3, 4+1, 4+2 within 8 beats
        const claveBar = bar % 2;
        if (claveBar === 0) {
            pcn.push(note(75, bs, 0.1, hv(40)));
            pcn.push(note(75, bs + 1.5, 0.1, hv(35)));
            pcn.push(note(75, bs + 3, 0.1, hv(38)));
        } else {
            pcn.push(note(75, bs + 1, 0.1, hv(35)));
            pcn.push(note(75, bs + 2, 0.1, hv(40)));
        }
        // Congas in variation section
        if (sec.name === 'Variation' || sec.name === 'Solo') {
            pcn.push(note(62, bs + 0.75, 0.15, hv(45))); // conga high
            pcn.push(note(63, bs + 2.25, 0.15, hv(40))); // conga mid
            if (bar % 4 === 3) pcn.push(note(64, bs + 3.5, 0.15, hv(50))); // conga low fill
        }
    }

    // ── WALKING BASS ─────────────────────────────────────────────────────
    // Quarter notes: root → 3rd/5th → passing → chromatic approach
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) break;
        const ci0 = getChordIdx(bs);
        const nextBar = Math.min(bs + 4, TB - 1);
        const ci1 = getChordIdx(nextBar);
        const root = BASS_ROOTS[ci0]!;
        const nextRoot = BASS_ROOTS[ci1]!;
        const voicing = JAZZ_VOICINGS[ci0]!;
        const sec = getSec(bs);
        const v = sec.name === 'Intro' ? 65 : sec.name === 'Outro' ? 55 : 80;

        // Beat 1: root
        bn.push(note(root, bs, 0.9, hv(v)));
        // Beat 2: 3rd or 5th (pick from voicing, down an octave)
        const choice = voicing[Math.floor(Math.random() * 2) + 1]! - 12;
        bn.push(note(choice, bs + 1, 0.9, hv(v - 5)));
        // Beat 3: scale passing tone
        const passing = root + (nextRoot > root ? 4 : -3);
        bn.push(note(passing, bs + 2, 0.9, hv(v - 8)));
        // Beat 4: chromatic approach to next root
        const approach = nextRoot > root ? nextRoot - 1 : nextRoot + 1;
        bn.push(note(approach, bs + 3, 0.9, hv(v - 3)));

        // Sub layer: sustained root
        sbn.push(note(root - 12, bs, 3.8, hv(70)));
    }

    // ── RHODES COMPING ───────────────────────────────────────────────────
    // Syncopated jazz chord stabs with humanization
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) break;
        const ci0 = getChordIdx(bs);
        const voicing = JAZZ_VOICINGS[ci0]!;
        const sec = getSec(bs);
        const v = sec.name === 'Intro' ? 55 : sec.name === 'Outro' ? 45 : 70;

        // Comp pattern varies by bar position
        const patIdx = bar % 4;
        if (patIdx === 0) {
            // Root position stab on 1
            for (const t of voicing) rn.push(note(t, bs + 0.1, 1.5, hv(v)));
            for (const t of voicing) rn.push(note(t, bs + 2.75, 0.8, hv(v - 10)));
        } else if (patIdx === 1) {
            // Anticipation on & of 4 (previous bar), stab on 2
            for (const t of voicing) rn.push(note(t, bs + 1, 1, hv(v)));
            for (const t of voicing) rn.push(note(t, bs + 3.5, 0.4, hv(v - 15)));
        } else if (patIdx === 2) {
            // Sparse: just on 1 and let ring
            for (const t of voicing) rn.push(note(t, bs + 0.15, 3.5, hv(v - 5)));
        } else {
            // Active: hits on 1, &2, 4
            for (const t of voicing) rn.push(note(t, bs, 0.5, hv(v)));
            for (const t of voicing) rn.push(note(t, bs + 1.5, 0.5, hv(v - 8)));
            for (const t of voicing) rn.push(note(t, bs + 3, 0.8, hv(v - 5)));
        }
    }

    // ── ORGAN PADS (B theme and return) ──────────────────────────────────
    for (let beat = 132; beat < 384; beat += 8) {
        const ci0 = getChordIdx(beat);
        const voicing = JAZZ_VOICINGS[ci0]!;
        for (const t of voicing) on.push(note(t - 12, beat, 7.5, hv(50)));
    }

    // ── BELL MELODY (A and B themes) ─────────────────────────────────────
    // Lyrical phrases in Eb major with jazz inflections
    const bellMelA: [number, number, number, number][] = [ // [off, pitch, dur, vel]
        [0, 67, 1.5, 75], [2, 65, 1, 70], [3, 63, 0.75, 72],
        [4, 62, 2, 68], [6, 63, 1, 65], [7, 65, 1, 70],
    ];
    const bellMelB: [number, number, number, number][] = [
        [0, 70, 2, 72], [2, 72, 1, 68], [3.5, 70, 0.5, 65],
        [4, 67, 1.5, 70], [6, 65, 1, 68], [7.5, 67, 0.5, 60],
    ];
    for (let phrase = 0; phrase < (300 - 48) / 8; phrase++) {
        const start = 48 + phrase * 8;
        if (start >= 300) break;
        const sec = getSec(start);
        if (sec.name === 'Solo') continue; // flute takes over
        const mel = phrase % 2 === 0 ? bellMelA : bellMelB;
        const transpose = sec.name === 'B Theme' ? 2 : 0;
        for (const [off, pitch, dur, vel] of mel) {
            bln.push(note(pitch + transpose, start + off, dur, hv(vel)));
        }
    }

    // ── FLUTE SOLO (over Solo and Return A sections) ─────────────────────
    // More improvisatory feel — longer phrases with wider intervals
    const flutePhrases: [number, number, number, number][][] = [
        [[0, 72, 1, 75], [1.5, 74, 0.5, 70], [2, 75, 2, 72], [4, 77, 1.5, 68], [6, 75, 1, 65], [7, 72, 1, 70]],
        [[0, 79, 0.75, 72], [1, 77, 0.75, 70], [2, 75, 1.5, 68], [4, 72, 2, 72], [6.5, 74, 1, 65], [7.5, 75, 0.5, 60]],
        [[0, 70, 2, 70], [2.5, 72, 1, 68], [4, 74, 1.5, 72], [6, 77, 1, 65], [7, 75, 1, 70]],
        [[0, 75, 1, 68], [1.5, 77, 0.5, 65], [2, 79, 2, 72], [4.5, 77, 1.5, 68], [6, 75, 1, 70], [7, 72, 1, 65]],
    ];
    for (let phrase = 0; phrase < (384 - 216) / 8; phrase++) {
        const start = 216 + phrase * 8;
        if (start >= 384) break;
        const phIdx = phrase % flutePhrases.length;
        for (const [off, pitch, dur, vel] of flutePhrases[phIdx]!) {
            fn.push(note(pitch, start + off, dur, hv(vel)));
        }
    }

    // ── SHIMMER PAD ──────────────────────────────────────────────────────
    for (let beat = 0; beat < TB; beat += 16) {
        const ci0 = getChordIdx(beat);
        const voicing = JAZZ_VOICINGS[ci0]!;
        const sec = getSec(beat);
        const v = sec.name === 'Intro' || sec.name === 'Outro' ? 35 : 50;
        for (const t of voicing) pdn.push(note(t + 12, beat, 15.5, hv(v)));
    }

    // ── SOFT STRINGS ─────────────────────────────────────────────────────
    for (let beat = 132; beat < TB; beat += 16) {
        const ci0 = getChordIdx(beat);
        const voicing = JAZZ_VOICINGS[ci0]!;
        const sec = getSec(beat);
        const v = sec.name === 'Outro' ? 30 : 45;
        for (const t of voicing) strn.push(note(t, beat, 15.5, hv(v)));
    }

    // ── ASSEMBLE ─────────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        rhythmFolder, drumTrack, percTrack,
        bassFolder, bassTrack, subTrack,
        keysFolder, rhodesTrack, organTrack,
        melodyFolder, fluteTrack, bellTrack,
        atmosFolder, padTrack, stringsTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: rhodesTrack.id });

    midiStore.set({
        notesByClipId: {
            [drumClip.id]: dn, [percClip.id]: pcn,
            [bassClip.id]: bn, [subClip.id]: sbn,
            [rhodesClip.id]: rn, [organClip.id]: on,
            [fluteClip.id]: fn, [bellClip.id]: bln,
            [padClip.id]: pdn, [stringsClip.id]: strn,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION ───────────────────────────────────────────────────────
    const rhodesVol = createAutomationLane(rhodesTrack.id, 'volume', 'Volume', 0, 1);
    rhodesVol.points = [
        { beat: 0, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 588, value: 0.2, curve: 'linear', tension: 0 },
    ];
    const strVol = createAutomationLane(stringsTrack.id, 'volume', 'Volume', 0, 1);
    strVol.points = [
        { beat: 132, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 164, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 588, value: 0.8, curve: 'linear', tension: 0 },
    ];
    const padVol = createAutomationLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVol.points = [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 48, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 492, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 560, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 588, value: 0.3, curve: 'linear', tension: 0 },
    ];
    automationStore.set({ lanes: [rhodesVol, strVol, padVol] });

    // ── MARKERS ──────────────────────────────────────────────────────────
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
            color: s.name.includes('A') ? 'oklch(0.38 0.08 200)'
                : s.name.includes('B') ? 'oklch(0.38 0.08 160)'
                : s.name === 'Solo' ? 'oklch(0.40 0.10 40)'
                : 'oklch(0.36 0.06 240)',
        })),
    });

    syncArrangement(tracks);
    projectStore.set({ name: 'Midnight Smoke (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false, loading: false });
}

// ---------------------------------------------------------------------------
// Demo Project 4: Native Showcase — "Brainfeeder" (Flying Lotus style)
// Key: Eb minor / Gb major | BPM: 83→158 (tempo varies) | ~6:12 (816 beats)
// NATIVE-ONLY: Uses native-eq, native-compressor, native-reverb, native-delay,
//              native-gate, native-limiter, native-gain + ALL web effects.
// ~50 tracks. Maximum complexity showcase.
// Structure: Fog(0-64) → Fracture(64-160) → Gravity(160-288) →
//            Warp(288-384) → Collapse(384-480) → Nebula(480-576) →
//            Hyperspace(576-720) → Dust(720-816)
// ---------------------------------------------------------------------------

