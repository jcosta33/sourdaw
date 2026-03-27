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
export async function demo4_NativeShowcase(): Promise<void> {
    const bpm = 83;
    const TB = 816;

    // Eb minor / Gb major: Eb F Gb Ab Bb Cb Db
    // Chord pool (MIDI voicings in octave 3-4)
    const CHORDS: Record<string, number[]> = {
        Ebm7:   [51, 54, 58, 62],  // Eb3 Gb3 Bb3 Db4
        Gbmaj7: [54, 58, 61, 65],  // Gb3 Bb3 Db4 F4
        Abm7:   [56, 59, 63, 66],  // Ab3 Cb4 Eb4 Gb4
        Bb7:    [58, 62, 65, 68],  // Bb3 D4  F4  Ab4
        Dbmaj7: [49, 53, 56, 60],  // Db3 F3  Ab3 C4
        Cbmaj7: [47, 51, 54, 58],  // Cb3 Eb3 Gb3 Bb3
        Fm7b5:  [53, 56, 59, 63],  // F3  Ab3 Cb4 Eb4
        Ebm9:   [51, 54, 58, 62, 66], // Eb3 Gb3 Bb3 Db4 F4
    };
    const BASS: Record<string, number> = {
        Ebm7: 39, Gbmaj7: 42, Abm7: 44, Bb7: 46, Dbmaj7: 37, Cbmaj7: 35, Fm7b5: 41, Ebm9: 39,
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
    const kickFolder = createTrack({ name: 'Kick Layers', kind: 'folder' });
    const kick808 = createTrack({ name: '808 Kick', kind: 'midi', parentId: kickFolder.id });
    const kickSub = createTrack({ name: 'Sub Kick', kind: 'midi', parentId: kickFolder.id });
    const kickClick = createTrack({ name: 'Kick Click', kind: 'midi', parentId: kickFolder.id });

    // Folder 2: Snare & Clap
    const snareFolder = createTrack({ name: 'Snares & Claps', kind: 'folder' });
    const snare808 = createTrack({ name: 'Snare Main', kind: 'midi', parentId: snareFolder.id });
    const clap808 = createTrack({ name: 'Clap Layer', kind: 'midi', parentId: snareFolder.id });
    const ghost = createTrack({ name: 'Ghost Snare', kind: 'midi', parentId: snareFolder.id });

    // Folder 3: Hi-Hats & Cymbals
    const hatFolder = createTrack({ name: 'Hi-Hats', kind: 'folder' });
    const hatClosed = createTrack({ name: 'Closed Hat', kind: 'midi', parentId: hatFolder.id });
    const hatOpen = createTrack({ name: 'Open Hat', kind: 'midi', parentId: hatFolder.id });
    const ride = createTrack({ name: 'Ride Texture', kind: 'midi', parentId: hatFolder.id });

    // Folder 4: Percussion
    const percFolder = createTrack({ name: 'Percussion', kind: 'folder' });
    const conga = createTrack({ name: 'Congas', kind: 'midi', parentId: percFolder.id });
    const cowbell = createTrack({ name: 'Cowbell', kind: 'midi', parentId: percFolder.id });
    const rimshot = createTrack({ name: 'Rimshot', kind: 'midi', parentId: percFolder.id });
    const clave = createTrack({ name: 'Clave', kind: 'midi', parentId: percFolder.id });
    const tomLow = createTrack({ name: 'Tom Low', kind: 'midi', parentId: percFolder.id });
    const tomHigh = createTrack({ name: 'Tom High', kind: 'midi', parentId: percFolder.id });
    const maracas = createTrack({ name: 'Maracas', kind: 'midi', parentId: percFolder.id });

    // Folder 5: Bass
    const bassFolder = createTrack({ name: 'Bass Section', kind: 'folder' });
    const reeseBass = createTrack({ name: 'Reese Bass', kind: 'midi', parentId: bassFolder.id });
    const subBass = createTrack({ name: '808 Sub', kind: 'midi', parentId: bassFolder.id });
    const acidBass = createTrack({ name: 'Acid Bass', kind: 'midi', parentId: bassFolder.id });

    // Folder 6: Keys & Chords
    const keysFolder = createTrack({ name: 'Keys & Chords', kind: 'folder' });
    const rhodes = createTrack({ name: 'Rhodes', kind: 'midi', parentId: keysFolder.id });
    const wurli = createTrack({ name: 'Wurlitzer', kind: 'midi', parentId: keysFolder.id });
    const clavTrack = createTrack({ name: 'Clavinet', kind: 'midi', parentId: keysFolder.id });
    const glassKeys = createTrack({ name: 'Glass Keys', kind: 'midi', parentId: keysFolder.id });

    // Folder 7: Leads & Melodies
    const leadFolder = createTrack({ name: 'Leads', kind: 'folder' });
    const liquidLead = createTrack({ name: 'Liquid Lead', kind: 'midi', parentId: leadFolder.id });
    const screamer = createTrack({ name: 'Screamer', kind: 'midi', parentId: leadFolder.id });
    const flute = createTrack({ name: 'Flute Lead', kind: 'midi', parentId: leadFolder.id });
    const bellMel = createTrack({ name: 'Bell Melody', kind: 'midi', parentId: leadFolder.id });

    // Folder 8: Pads & Textures
    const padFolder = createTrack({ name: 'Pads & Textures', kind: 'folder' });
    const darkDrone = createTrack({ name: 'Dark Drone', kind: 'midi', parentId: padFolder.id });
    const etherealPad = createTrack({ name: 'Ethereal Pad', kind: 'midi', parentId: padFolder.id });
    const warmStrings = createTrack({ name: 'Warm Strings', kind: 'midi', parentId: padFolder.id });
    const nativeAmb = createTrack({ name: 'Native Ambient', kind: 'midi', parentId: padFolder.id });
    const lofiPad = createTrack({ name: 'Lo-Fi Pad', kind: 'midi', parentId: padFolder.id });

    // Folder 9: FX & Glitch
    const fxFolder = createTrack({ name: 'FX & Glitch', kind: 'folder' });
    const noiseSweep = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const glitchPluck = createTrack({ name: 'Glitch Pluck', kind: 'midi', parentId: fxFolder.id });
    const crystalArp = createTrack({ name: 'Crystal Arp', kind: 'midi', parentId: fxFolder.id });
    const darkPulse = createTrack({ name: 'Dark Pulse', kind: 'midi', parentId: fxFolder.id });
    const stab = createTrack({ name: 'Stab FX', kind: 'midi', parentId: fxFolder.id });
    const riser = createTrack({ name: 'Riser', kind: 'midi', parentId: fxFolder.id });

    // Folder 10: Bus Processing
    const busFolder = createTrack({ name: 'Bus Processing', kind: 'folder' });
    const drumBus = createTrack({ name: 'Drum Bus', kind: 'midi', parentId: busFolder.id });
    const synthBus = createTrack({ name: 'Synth Bus', kind: 'midi', parentId: busFolder.id });

    // ── APPLY PRESETS (mix of native + web) ──────────────────────────────
    const allDrumTracks = [kick808, kickSub, kickClick, snare808, clap808, ghost,
        hatClosed, hatOpen, ride, conga, cowbell, rimshot, clave, tomLow, tomHigh, maracas, drumBus];
    for (const t of allDrumTracks) applyPreset(t, 'factory-drumkit-808');

    applyPreset(reeseBass, 'synth-bass-reese');
    applyPreset(subBass, 'synth-bass-808-sine');
    applyPreset(acidBass, 'synth-bass-acid');
    applyPreset(rhodes, 'synth-keys-electric-piano');
    applyPreset(wurli, 'synth-keys-wurlitzer');
    applyPreset(clavTrack, 'synth-keys-clavinet');
    applyPreset(glassKeys, 'factory-keys-bell');
    applyPreset(liquidLead, 'synth-lead-liquid');
    applyPreset(screamer, 'synth-lead-screamer');
    applyPreset(flute, 'factory-synth-flute');
    applyPreset(bellMel, 'factory-keys-bell');
    applyPreset(darkDrone, 'synth-pad-dark-drone');
    applyPreset(etherealPad, 'synth-pad-ethereal');
    applyPreset(warmStrings, 'synth-pad-warm-strings');
    applyPreset(nativeAmb, 'factory-native-ambient-texture');
    applyPreset(lofiPad, 'factory-native-lofi-delay');
    applyPreset(noiseSweep, 'synth-sfx-noise-sweep');
    applyPreset(glitchPluck, 'synth-sfx-glitch-pluck');
    applyPreset(crystalArp, 'synth-arp-crystal');
    applyPreset(darkPulse, 'synth-arp-dark-pulse');
    applyPreset(stab, 'factory-fx-stab');
    applyPreset(riser, 'factory-fx-riser');
    applyPreset(synthBus, 'factory-drumkit-808'); // placeholder for bus

    // ── PANNING for width ────────────────────────────────────────────────
    hatClosed.pan = 10; hatOpen.pan = -15; ride.pan = 25;
    conga.pan = -20; cowbell.pan = 30; rimshot.pan = -10; clave.pan = 35;
    maracas.pan = -25; tomLow.pan = -30; tomHigh.pan = 15;
    rhodes.pan = -20; wurli.pan = 15; clavTrack.pan = -10;
    glassKeys.pan = 25; liquidLead.pan = 10; screamer.pan = -15;
    flute.pan = 20; bellMel.pan = -25; crystalArp.pan = -35;
    darkPulse.pan = 30; glitchPluck.pan = -30;
    etherealPad.pan = -5; warmStrings.pan = 5;
    kickSub.gain = 0.7; ghost.gain = 0.3; subBass.gain = 0.6;
    lofiPad.gain = 0.4; nativeAmb.gain = 0.5;

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
    const allClips = [ck808,cksub,ckclick,csn,cclap,cghost,chc,cho,cride,cconga,ccow,crim,cclv,ctlow,cthi,cmar,
        creese,csub808,cacid,crhodes,cwurli,cclav,cglass,cliquid,cscream,cflute,cbell,cdrone,cether,cwarm,
        cnamb,clofi,cnoise,cglitch,ccrystal,cdpulse,cstab,criser];
    for (const c of allClips) N[c.id] = [];

    const isDense = (b: number) => R(b, 160, 288) || R(b, 384, 480) || R(b, 576, 720);
    const isBreak = (b: number) => R(b, 288, 384) || R(b, 480, 576);

    // ── KICK LAYERS ──────────────────────────────────────────────────────
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b >= TB) break;
        const sec = getSec(b);
        const p = b % 4;

        // Kick 808: broken beat patterns — NOT 4-on-floor
        const bar = Math.floor(b / 4);
        const patIdx = bar % 4;
        const kickHits = [
            [0, 1.75, 2.5],      // pattern 0
            [0, 0.75, 2, 3.25],  // pattern 1
            [0.5, 1.5, 3],       // pattern 2
            [0, 1, 2.25, 3.5],   // pattern 3
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
            const swing = (s % 2 === 1) ? 0.03 : 0;
            const accent = p % 1 === 0 ? 70 : p % 0.5 === 0 ? 50 : 30;
            const secVel = sec.name === 'Fog' ? 0.5 : sec.name === 'Dust' ? 0.4 : 1;
            const v = Math.round(accent * secVel);
            if (v > 10) N[chc.id]!.push(note(42, b + swing, 0.1, hv(v)));
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
        if (bs < 64 || bs >= TB) continue;
        const root = broot(bs);
        const sec = getSec(bs);
        if (sec.name === 'Dust') continue;
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
        [0, 0, 0.125], [0.25, 12, 0.1], [0.5, 7, 0.125], [0.75, 0, 0.125],
        [1, 5, 0.25], [1.5, 0, 0.25], [2, 12, 0.125], [2.25, 7, 0.125],
        [2.5, 5, 0.25], [3, 0, 0.5],
    ];
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 288 || bs >= 720) continue;
        const root = broot(bs);
        for (const [off, iv, dur] of acidPat) {
            N[cacid.id]!.push(note(root + iv!, bs + off!, dur!, hv(95)));
        }
    }

    // ── RHODES (broken chord comping throughout) ─────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs >= TB) break;
        const ch = cv(bs);
        const sec = getSec(bs);
        const v = sec.name === 'Fog' || sec.name === 'Dust' ? 50 : 70;
        const pat = bar % 3;
        if (pat === 0) {
            for (const t of ch) N[crhodes.id]!.push(note(t, bs + 0.1, 2, hv(v)));
            for (const t of ch) N[crhodes.id]!.push(note(t, bs + 2.75, 0.8, hv(v - 12)));
        } else if (pat === 1) {
            for (const t of ch) N[crhodes.id]!.push(note(t, bs + 0.5, 3, hv(v - 5)));
        } else {
            for (const t of ch) N[crhodes.id]!.push(note(t, bs, 0.5, hv(v)));
            for (const t of ch) N[crhodes.id]!.push(note(t, bs + 1.5, 0.5, hv(v - 8)));
            for (const t of ch) N[crhodes.id]!.push(note(t, bs + 3, 0.8, hv(v - 5)));
        }
    }

    // ── WURLITZER (mid sections, funky stabs) ────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 160 || bs >= 576) continue;
        const ch = cv(bs);
        if (bar % 2 === 0) {
            for (const t of ch) N[cwurli.id]!.push(note(t + 12, bs + 0.75, 0.2, hv(65)));
            for (const t of ch) N[cwurli.id]!.push(note(t + 12, bs + 2.5, 0.15, hv(55)));
        }
    }

    // ── CLAVINET (Warp+, percussive hits) ────────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 288 || bs >= 720) continue;
        const ch = cv(bs);
        N[cclav.id]!.push(note(ch[0]! + 12, bs + 1, 0.15, hv(75)));
        if (bar % 2 === 1) N[cclav.id]!.push(note(ch[2]! + 12, bs + 3.25, 0.1, hv(60)));
    }

    // ── GLASS KEYS (sparse bell-like accents) ────────────────────────────
    for (let bar = 0; bar < TB / 4; bar++) {
        const bs = bar * 4;
        if (bs < 64 || bs >= TB) continue;
        const ch = cv(bs);
        if (bar % 4 === 0) N[cglass.id]!.push(note(ch[3]! + 12, bs, 2, hv(55)));
        if (bar % 8 === 4) N[cglass.id]!.push(note(ch[1]! + 12, bs + 2, 1.5, hv(45)));
    }

    // ── LIQUID LEAD (melodic phrases) ────────────────────────────────────
    // Eb minor pentatonic: Eb=63 Gb=66 Ab=68 Bb=70 Db=73 Eb=75
    const lMelA: [number, number, number][] = [
        [0, 75, 1], [1.5, 73, 0.5], [2, 70, 1.5], [4, 68, 1], [5, 70, 0.5], [5.5, 73, 2.5],
    ];
    const lMelB: [number, number, number][] = [
        [0, 70, 0.5], [0.5, 73, 0.5], [1, 75, 2], [3, 73, 0.5], [3.5, 70, 0.5],
        [4, 68, 1.5], [6, 66, 1], [7, 68, 1],
    ];
    for (let ph = 0; ph < (720 - 160) / 8; ph++) {
        const start = 160 + ph * 8;
        if (start >= 720) break;
        if (isBreak(start) && ph % 2 === 0) continue; // leave space
        const mel = ph % 2 === 0 ? lMelA : lMelB;
        for (const [off, pitch, dur] of mel) {
            N[cliquid.id]!.push(note(pitch, start + off, dur, hv(80)));
        }
    }

    // ── SCREAMER (Collapse section only — intense) ───────────────────────
    const sMel: [number, number, number][] = [
        [0, 75, 0.5], [0.5, 78, 0.5], [1, 80, 1.5], [3, 78, 1],
        [4, 75, 0.5], [4.5, 73, 0.5], [5, 70, 2], [7, 73, 1],
    ];
    for (let ph = 0; ph < (576 - 384) / 8; ph++) {
        const start = 384 + ph * 8;
        for (const [off, pitch, dur] of sMel) {
            N[cscream.id]!.push(note(pitch, start + off, dur, hv(100)));
        }
    }

    // ── FLUTE (Fracture through Collapse, gentle) ────────────────────────
    const fMelodies: [number, number, number][][] = [
        [[0, 68, 2], [2.5, 70, 1], [4, 73, 1.5], [6, 70, 1], [7, 68, 1]],
        [[0, 73, 1], [1.5, 75, 0.5], [2, 73, 2], [4.5, 70, 1.5], [6.5, 68, 1.5]],
        [[0, 66, 2], [2.5, 68, 1], [4, 70, 2], [6.5, 73, 1.5]],
    ];
    for (let ph = 0; ph < (480 - 64) / 8; ph++) {
        const start = 64 + ph * 8;
        if (start >= 480) break;
        if (isDense(start) && ph % 3 !== 0) continue;
        const mel = fMelodies[ph % fMelodies.length]!;
        for (const [off, pitch, dur] of mel) {
            N[cflute.id]!.push(note(pitch, start + off, dur, hv(65)));
        }
    }

    // ── BELL MELODY (sparse throughout) ──────────────────────────────────
    for (let beat = 0; beat < TB; beat += 16) {
        const ch = cv(beat);
        N[cbell.id]!.push(note(ch[2]! + 24, beat + 2, 2, hv(40)));
        if (beat % 32 === 0) N[cbell.id]!.push(note(ch[0]! + 24, beat + 10, 3, hv(35)));
    }

    // ── PADS & TEXTURES ──────────────────────────────────────────────────
    // Dark Drone: sustained throughout
    for (let beat = 0; beat < TB; beat += 32) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 3)) N[cdrone.id]!.push(note(t - 12, beat, 31, hv(35)));
    }
    // Ethereal Pad: mid sections
    for (let beat = 160; beat < TB; beat += 16) {
        const ch = cv(beat);
        for (const t of ch) N[cether.id]!.push(note(t + 12, beat, 15, hv(40)));
    }
    // Warm Strings: from Warp onward
    for (let beat = 288; beat < TB; beat += 16) {
        const ch = cv(beat);
        for (const t of ch) N[cwarm.id]!.push(note(t, beat, 15.5, hv(45)));
    }
    // Native Ambient: throughout, very subtle
    for (let beat = 0; beat < TB; beat += 32) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 2)) N[cnamb.id]!.push(note(t + 12, beat, 30, hv(30)));
    }
    // Lo-Fi Pad: Fracture through Hyperspace
    for (let beat = 64; beat < 720; beat += 16) {
        const ch = cv(beat);
        for (const t of ch.slice(0, 3)) N[clofi.id]!.push(note(t, beat, 15, hv(35)));
    }

    // ── FX & GLITCH ──────────────────────────────────────────────────────
    // Noise sweeps before section changes
    const sweepBeats = [48, 144, 272, 368, 464, 560, 704];
    for (const sb of sweepBeats) N[cnoise.id]!.push(note(60, sb, 16, 65));

    // Glitch pluck: rapid random in dense sections
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 160 || b >= 720 || !isDense(b)) continue;
        if (Math.random() < 0.06) {
            const pitch = 60 + Math.floor(Math.random() * 24);
            N[cglitch.id]!.push(note(pitch, b, 0.08, hv(55)));
        }
    }

    // Crystal arp: 16th note patterns in Warp+
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 288 || b >= 720) continue;
        const ch = cv(b);
        const idx = s % ch.length;
        const oct = Math.floor(s / ch.length) % 3 === 0 ? 12 : 0;
        N[ccrystal.id]!.push(note(ch[idx]! + 12 + oct, b, 0.15, hv(50)));
    }

    // Dark pulse: 16th notes in Gravity through Nebula
    for (let s = 0; s < TB * 4; s++) {
        const b = s * 0.25;
        if (b < 160 || b >= 576) continue;
        if (s % 2 === 0) {
            N[cdpulse.id]!.push(note(broot(b), b, 0.1, hv(45)));
        }
    }

    // Stabs: accent chords in drops
    for (let beat = 160; beat < 720; beat += 8) {
        if (isBreak(beat)) continue;
        const ch = cv(beat);
        for (const t of ch) N[cstab.id]!.push(note(t + 12, beat, 0.1, hv(85)));
    }

    // Risers before every section
    for (const sec of SECTIONS) {
        if (sec.start > 0) N[criser.id]!.push(note(60, sec.start - 16, 16, 70));
    }

    // ── ASSEMBLE ALL TRACKS ──────────────────────────────────────────────
    const tracks = [
        masterTrack,
        kickFolder, kick808, kickSub, kickClick,
        snareFolder, snare808, clap808, ghost,
        hatFolder, hatClosed, hatOpen, ride,
        percFolder, conga, cowbell, rimshot, clave, tomLow, tomHigh, maracas,
        bassFolder, reeseBass, subBass, acidBass,
        keysFolder, rhodes, wurli, clavTrack, glassKeys,
        leadFolder, liquidLead, screamer, flute, bellMel,
        padFolder, darkDrone, etherealPad, warmStrings, nativeAmb, lofiPad,
        fxFolder, noiseSweep, glitchPluck, crystalArp, darkPulse, stab, riser,
        busFolder, drumBus, synthBus,
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

    automationStore.set({ lanes: [
        kickVol, reeseVol, droneVol, rhodesVol, etherVol, acidVol,
        glitchVol, crystalVol, liquidVol, hatVol, warmVol, screamVol,
    ] });

    // ── MARKERS ──────────────────────────────────────────────────────────
    const secColors = [
        'oklch(0.30 0.08 270)', 'oklch(0.35 0.10 300)', 'oklch(0.40 0.13 350)',
        'oklch(0.38 0.12 30)',  'oklch(0.42 0.15 10)',  'oklch(0.38 0.10 200)',
        'oklch(0.45 0.18 60)',  'oklch(0.32 0.06 240)',
    ];
    markerStore.set({
        markers: SECTIONS.map((s, i) => ({
            id: crypto.randomUUID(), beat: s.start, name: s.name, color: secColors[i]!,
        })),
        sections: SECTIONS.map((s, i) => ({
            id: crypto.randomUUID(), startBeat: s.start, endBeat: s.end, name: s.name, color: secColors[i]!,
        })),
    });

    syncArrangement(tracks);
    projectStore.set({ name: 'Brainfeeder (Demo — Native)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false, loading: false });
}
