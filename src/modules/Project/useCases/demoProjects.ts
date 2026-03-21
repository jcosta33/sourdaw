import { trackStore } from '#/modules/Track/stores/trackStore';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { projectStore } from '../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { createTrack } from '#/modules/Track/useCases/trackQueries';
import { createAutomationLane } from '#/modules/Track/models/Automation';
import { arrangementStore, defaultArrangementId } from '../stores/arrangementStore';
import type { MidiNote } from '#/modules/Track/models/MidiNote';
import type { StretchMode } from '#/modules/Track/models/Track';
import { getFactoryPresets } from '#/modules/Track/useCases/soundPresetLibrary';

// Helper to create notes inline
function note(pitch: number, start: number, duration: number, vel = 100): MidiNote {
    return {
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
        pitch,
        startBeat: start,
        duration,
        velocity: vel,
    };
}

function applyPreset(track: any, presetId: string) {
    const preset = getFactoryPresets().find((p) => p.id === presetId);
    if (preset && preset.devices) {
        track.devices = preset.devices.map((d: any) => ({
            id: `dev-${crypto.randomUUID()}`,
            name: d.name,
            type: d.type,
            bypassed: false,
            parameterValues: { ...d.parameterValues },
        }));
    }
}

function createAudioClip(trackId: string, name: string, startBeat: number, endBeat: number, bufferId: string) {
    return {
        id: `clip-${crypto.randomUUID()}`,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'audio' as const,
        audioBufferId: bufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
        stretchMode: 'repitch' as StretchMode,
    };
}

function createMidiClip(trackId: string, name: string, startBeat: number, endBeat: number) {
    return {
        id: `clip-${crypto.randomUUID()}`,
        trackId,
        name,
        startBeat,
        endBeat,
        type: 'midi' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };
}

// ---------------------------------------------------------------------------
// Demo Project 1: Kiasmos-style Ambient/IDM — "Resonance"
// Key: D minor | BPM: 120 | ~2:40
// Structure: Intro(0-32) → Emergence(32-64) → Groove(64-128) →
//            Catharsis(128-192) → Breakdown(192-224) → Rise(224-288) → Outro(288-320)
// ---------------------------------------------------------------------------

export async function demo1_TheCompleteMix(): Promise<void> {
    const bpm = 120;
    const TB = 320; // totalBeats

    // D minor aeolian: D E F G A Bb C
    // Chord cycle (16 beats each): Dm7 → Gm7 → Am7 → Bbmaj7
    // Roots (octave 2): D2=38, G2=43, A2=45, Bb2=46
    // Sub roots (octave 1): D1=26, G1=31, A1=33, Bb1=34
    const CHORDS = [
        { sub: 26, root: 38, third: 41, fifth: 45, seventh: 48, ninth: 52 },  // Dm7(9)
        { sub: 31, root: 43, third: 46, fifth: 50, seventh: 53, ninth: 55 },  // Gm7(9)
        { sub: 33, root: 45, third: 48, fifth: 52, seventh: 55, ninth: 57 },  // Am7(9)
        { sub: 34, root: 46, third: 50, fifth: 53, seventh: 57, ninth: 60 },  // Bbmaj7(9)
    ];
    const ch = (beat: number) => CHORDS[Math.floor(beat / 16) % 4]!;
    const hv = (base: number, r = 8) =>
        Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));

    // ---- TRACKS ----
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    const kickTrack    = createTrack({ name: 'Kick',         kind: 'audio' });
    const snareTrack   = createTrack({ name: 'Clap',         kind: 'audio' });
    const hatCTrack    = createTrack({ name: 'HH Closed',    kind: 'audio' });
    const hatOTrack    = createTrack({ name: 'HH Open',      kind: 'audio' });
    const percTrack    = createTrack({ name: 'Perc / Shaker',kind: 'audio' });
    const subTrack     = createTrack({ name: 'Sub Bass',     kind: 'midi' });
    const pulseTrack   = createTrack({ name: 'Pulse Bass',   kind: 'midi' });
    const padTrack     = createTrack({ name: 'Atmos Pad',    kind: 'midi' });
    const stringsTrack = createTrack({ name: 'Strings',      kind: 'midi' });
    const arpTrack     = createTrack({ name: 'Arpeggio',     kind: 'midi' });
    const leadTrack    = createTrack({ name: 'Lead',         kind: 'midi' });
    const pianoTrack   = createTrack({ name: 'Piano',        kind: 'midi' });

    applyPreset(subTrack,     'factory-bass-sub');
    applyPreset(pulseTrack,   'factory-bass-analog');
    applyPreset(padTrack,     'factory-pad-warm');
    applyPreset(stringsTrack, 'factory-pad-warm');
    applyPreset(arpTrack,     'factory-keys-pluck');
    applyPreset(leadTrack,    'factory-lead-classic');
    applyPreset(pianoTrack,   'factory-keys-epiano');

    // Gain / Pan — stereo field and mix balance
    kickTrack.gain    = 0.95; kickTrack.pan    =  0.00;
    snareTrack.gain   = 0.72; snareTrack.pan   =  0.04;
    hatCTrack.gain    = 0.52; hatCTrack.pan    =  0.22;
    hatOTrack.gain    = 0.48; hatOTrack.pan    = -0.20;
    percTrack.gain    = 0.42; percTrack.pan    =  0.38;
    subTrack.gain     = 0.92; subTrack.pan     =  0.00;
    pulseTrack.gain   = 0.68; pulseTrack.pan   =  0.08;
    padTrack.gain     = 0.78; padTrack.pan     =  0.14;
    stringsTrack.gain = 0.62; stringsTrack.pan = -0.18;
    arpTrack.gain     = 0.58; arpTrack.pan     =  0.36;
    leadTrack.gain    = 0.72; leadTrack.pan    = -0.10;
    pianoTrack.gain   = 0.68; pianoTrack.pan   = -0.26;

    // ---- DRUM BUFFERS ----
    const cx = Date.now();
    const bK = `d1k-${cx}`, bS = `d1s-${cx}`, bHC = `d1hc-${cx}`;
    const bHO = `d1ho-${cx}`, bP = `d1p-${cx}`;
    await Promise.all([
        generateDemoDrumBuffer(bK,  TB, bpm, 'kick'),
        generateDemoDrumBuffer(bS,  TB, bpm, 'snare'),
        generateDemoDrumBuffer(bHC, TB, bpm, 'hat'),
        generateDemoDrumBuffer(bHO, TB, bpm, 'hat'),
        generateDemoDrumBuffer(bP,  TB, bpm, 'shaker'),
    ]);

    // ---- AUDIO CLIPS (drums enter in stages) ----
    // Kick: ghost at 32, main at 64, full force at 128, returns at 256
    const kA = createAudioClip(kickTrack.id, 'Kick Ghost',  32, 64,  bK);
    const kB = createAudioClip(kickTrack.id, 'Kick Build',  64, 128, bK);
    const kC = createAudioClip(kickTrack.id, 'Kick Drop',  128, 224, bK);
    const kD = createAudioClip(kickTrack.id, 'Kick Rise',  256, TB,  bK);
    kickTrack.clips = [kA, kB, kC, kD];

    const sA = createAudioClip(snareTrack.id, 'Clap A',  64, 192, bS);
    const sB = createAudioClip(snareTrack.id, 'Clap B', 224, TB,  bS);
    snareTrack.clips = [sA, sB];

    hatCTrack.clips = [createAudioClip(hatCTrack.id, 'HH 16th', 64, TB, bHC)];

    const hA = createAudioClip(hatOTrack.id, 'HH Open A',  96, 192, bHO);
    const hB = createAudioClip(hatOTrack.id, 'HH Open B', 240, TB,  bHO);
    hatOTrack.clips = [hA, hB];

    const pA = createAudioClip(percTrack.id, 'Shaker A', 96, 192, bP);
    const pB = createAudioClip(percTrack.id, 'Shaker B', 256, TB,  bP);
    percTrack.clips = [pA, pB];

    // ---- MIDI CLIPS (all start at 0 — notes stored absolute) ----
    const subClip    = createMidiClip(subTrack.id,     'Sub Drone',  0, TB);
    const pulseClip  = createMidiClip(pulseTrack.id,   'Pulse Seq',  0, TB);
    const padClip    = createMidiClip(padTrack.id,     'Atmos',      0, TB);
    const strClip    = createMidiClip(stringsTrack.id, 'Strings',    0, TB);
    const arpClip    = createMidiClip(arpTrack.id,     'Arp 16th',   0, TB);
    const leadClip   = createMidiClip(leadTrack.id,    'Lead Motif', 0, TB);
    const pianoClip  = createMidiClip(pianoTrack.id,   'Piano',      0, TB);
    subTrack.clips    = [subClip];
    pulseTrack.clips  = [pulseClip];
    padTrack.clips    = [padClip];
    stringsTrack.clips= [strClip];
    arpTrack.clips    = [arpClip];
    leadTrack.clips   = [leadClip];
    pianoTrack.clips  = [pianoClip];

    // ---- MIDI NOTE GENERATION ----
    const subN:    MidiNote[] = [];
    const pulseN:  MidiNote[] = [];
    const padN:    MidiNote[] = [];
    const strN:    MidiNote[] = [];
    const arpN:    MidiNote[] = [];
    const leadN:   MidiNote[] = [];
    const pianoN:  MidiNote[] = [];

    // --- SUB BASS: deep root drone every 2 beats ---
    // Sections: quiet intro(0-32), emergence(32-64), groove(64-192),
    //           soft breakdown(192-224), full rise(224-288), decay(288-320)
    for (let b = 0; b < TB; b += 2) {
        const c = ch(b);
        const inBreakdown = b >= 192 && b < 224;
        const velBase = b < 16 ? 40 : b < 32 ? 55 : b < 64 ? 68 : inBreakdown ? 50 : b >= 288 ? 60 : 82;
        subN.push(note(c.sub, b, 1.95, hv(velBase, 5)));
        // Octave upper accent on last beat of phrases
        if (b % 16 === 14 && !inBreakdown && b >= 64 && b < 288) {
            subN.push(note(c.sub + 12, b + 0.5, 0.4, hv(85, 10)));
        }
    }

    // --- PULSE BASS: syncopated 8th-note seq, enters at beat 32 ---
    // Pattern within 4-beat bar: hit on 0, 0.5, 1.5, 2, 3, 3.5
    const pulseOffsets = [0, 0.5, 1.5, 2, 3, 3.5];
    for (let bar = 8; bar < TB / 4; bar++) {
        const b = bar * 4;
        if (b >= 192 && b < 224) continue; // silence in breakdown
        const c = ch(b);
        const velMult = b < 64 ? 0.75 : b >= 288 ? 0.8 : 1.0;
        for (const off of pulseOffsets) {
            const bt = b + off;
            const isAcc = off === 0 || off === 2;
            const pitch = (off === 0.5 || off === 1.5) ? c.fifth : c.root;
            pulseN.push(note(pitch, bt, 0.4, hv(Math.round((isAcc ? 90 : 68) * velMult), 10)));
        }
    }

    // --- ATMOS PAD: lush wide chords starting from bar 1 ---
    // 4-voice voicing, long sustain, upper octave +12
    for (let b = 0; b < TB; b += 16) {
        const c = ch(b);
        const inBD = b >= 192 && b < 224;
        const velBase = b < 16 ? 35 : b < 32 ? 48 : b < 64 ? 58 : inBD ? 42 : b >= 288 ? 55 : 70;
        const dur = inBD ? 14 : 15.8;
        // Root voicing (D3 area): root, third, fifth, seventh
        padN.push(note(c.root  + 12, b, dur, hv(velBase, 6)));       // D3
        padN.push(note(c.third + 12, b, dur, hv(velBase - 4, 6)));   // F3
        padN.push(note(c.fifth + 12, b, dur, hv(velBase - 8, 8)));   // A3
        padN.push(note(c.seventh + 12, b, dur, hv(velBase - 12, 8)));// C4
        // High shimmer — enters at catharsis
        if (b >= 128 && !inBD) {
            padN.push(note(c.root + 24, b, dur, hv(velBase - 20, 10))); // D4 shimmer
        }
    }

    // --- STRINGS: enter at groove(64), rest in breakdown, return at rise(224) ---
    // Counter-voice: moves in contrary motion to pad
    for (let b = 64; b < TB; b += 16) {
        if (b >= 192 && b < 224) continue;
        const c = ch(b);
        const velBase = b < 128 ? 52 : b >= 256 ? 62 : 65;
        const dur = 15.6;
        // Voice the strings above the pad but with 5th and octave
        strN.push(note(c.fifth  + 12, b + 0.5, dur, hv(velBase, 8)));     // counter-voice
        strN.push(note(c.ninth  + 12, b + 0.5, dur, hv(velBase - 6, 8))); // 9th colour
        // 2-bar answer phrase on beat 8
        strN.push(note(c.root   + 24, b + 8, 7.5, hv(velBase - 10, 10)));
    }

    // --- ARPEGGIO: chord-tone sequence, D-minor-scale-only notes ---
    // Each chord has a pre-defined set of pitches in octave 4-5, all in D minor
    // Dm7(9): D4, F4, A4, C5, D5    Gm7(9): G4, Bb4, D5, F5
    // Am7(9): A4, C5, E5, G5        Bbmaj7: Bb4, D5, F5, A5
    const ARP_POOLS: number[][] = [
        [62, 65, 69, 72, 74],   // Dm7: D4 F4 A4 C5 D5
        [67, 70, 74, 77],       // Gm7: G4 Bb4 D5 F5
        [69, 72, 76, 79],       // Am7: A4 C5 E5 G5
        [70, 74, 77, 81],       // Bbmaj7: Bb4 D5 F5 A5
    ];
    // Step pattern: 0,2,1,3,2,4,3,1 (cycling through pool indices)
    const ARP_STEPS = [0, 2, 1, 3, 2, 4, 3, 1];
    let arpStep = 0;
    for (let b = 64; b < 256; b += 0.25) {
        if (b >= 192 && b < 224) continue;
        const chordIdx = Math.floor(b / 16) % 4;
        const pool = ARP_POOLS[chordIdx]!;
        const pitch = pool[ARP_STEPS[arpStep % ARP_STEPS.length]! % pool.length]!;
        const velBase = b < 128 ? 58 : 65;
        const acc = b % 1 === 0;
        arpN.push(note(pitch, b, 0.22, hv(acc ? velBase : velBase - 12, 8)));
        arpStep++;
    }
    // Arp returns at rise (240-288)
    arpStep = 0;
    for (let b = 240; b < 288; b += 0.25) {
        const chordIdx = Math.floor(b / 16) % 4;
        const pool = ARP_POOLS[chordIdx]!;
        const pitch = pool[ARP_STEPS[arpStep % ARP_STEPS.length]! % pool.length]!;
        arpN.push(note(pitch, b, 0.22, hv(62, 10)));
        arpStep++;
    }

    // --- LEAD MELODY: sparse emotional motif ---
    // Appears in catharsis(128-192) and final rise(256-288)
    // D minor pentatonic: D(62), F(65), G(67), A(69), C(72) in octave 4
    const leadMotif = [
        [0,  62, 2.0, 92], [2,  65, 1.0, 80], [3,  67, 0.5, 75],
        [3.5,69, 1.5, 88], [5,  67, 1.0, 70], [6,  65, 2.0, 82],
        [8,  72, 3.0, 95], [11, 69, 1.0, 78], [12, 67, 0.5, 72],
        [12.5,65,3.5, 85], // phrase end
    ] as const;

    // Catharsis section — lead plays in full
    for (let phrase = 0; phrase < 4; phrase++) {
        const base = 128 + phrase * 16;
        for (const [off, pitch, dur, vel] of leadMotif) {
            leadN.push(note(pitch, base + off, dur, hv(vel, 8)));
        }
    }
    // Return in finale with octave variation
    for (let phrase = 0; phrase < 2; phrase++) {
        const base = 256 + phrase * 16;
        const shift = phrase === 1 ? 12 : 0; // octave up on final phrase
        for (const [off, pitch, dur, vel] of leadMotif) {
            leadN.push(note(pitch + shift, base + off, dur, hv(vel - 5, 10)));
        }
    }

    // --- PIANO: sparse, emotional, bookend the song ---
    // Intro (0-32): single notes, very sparse
    // Bridge (192-224): stripped down — piano + sub only
    // Outro (288-320): slow farewell chords
    const pianoSparse = (startBeat: number, c: typeof CHORDS[0], velBase: number) => {
        pianoN.push(note(c.root + 24,   startBeat,       1.5, hv(velBase, 8)));
        pianoN.push(note(c.fifth + 24,  startBeat + 2,   1.0, hv(velBase - 8, 8)));
        pianoN.push(note(c.third + 24,  startBeat + 4,   2.0, hv(velBase - 4, 10)));
        pianoN.push(note(c.seventh+ 24, startBeat + 7,   1.5, hv(velBase - 12, 10)));
    };
    // Intro — very soft, single notes
    for (let b = 2; b < 32; b += 8) pianoSparse(b, ch(b), 48);
    // Breakdown bridge — piano solo, most exposed moment
    for (let b = 192; b < 224; b += 8) pianoSparse(b, ch(b), 60);
    // Outro — slower, more harmonic
    for (let b = 288; b < TB; b += 16) {
        const c = ch(b);
        pianoN.push(note(c.root + 24,    b,      7.5, hv(55, 6)));
        pianoN.push(note(c.third + 24,   b + 0.1,7.5, hv(48, 6)));
        pianoN.push(note(c.seventh + 24, b + 0.2,7.5, hv(42, 6)));
    }

    // ---- TRACK ASSEMBLY ----
    const tracks = [
        masterTrack, kickTrack, snareTrack, hatCTrack, hatOTrack, percTrack,
        subTrack, pulseTrack, padTrack, stringsTrack, arpTrack, leadTrack, pianoTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: padTrack.id });

    midiStore.set({
        notesByClipId: {
            [subClip.id]:   subN,
            [pulseClip.id]: pulseN,
            [padClip.id]:   padN,
            [strClip.id]:   strN,
            [arpClip.id]:   arpN,
            [leadClip.id]:  leadN,
            [pianoClip.id]: pianoN,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ---- AUTOMATION ----
    // Sub bass: swells from silence → full over intro, dips in breakdown
    const subVolLane = createAutomationLane(subTrack.id, 'volume', 'Volume', 0, 1);
    subVolLane.points = [
        { beat: 0,   value: 0.1, curve: 'linear', tension: 0 },
        { beat: 16,  value: 0.5, curve: 'linear', tension: 0 },
        { beat: 32,  value: 0.8, curve: 'linear', tension: 0 },
        { beat: 64,  value: 1.0, curve: 'linear', tension: 0 },
        { beat: 192, value: 0.45,curve: 'linear', tension: 0 },
        { beat: 224, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.75,curve: 'linear', tension: 0 },
        { beat: TB,  value: 0.1, curve: 'linear', tension: 0 },
    ];

    // Atmospheric pad: gradual swell, sidechain-style dip at kick drops
    const padVolLane = createAutomationLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVolLane.points = [
        { beat: 0,   value: 0.15,curve: 'linear', tension: 0 },
        { beat: 32,  value: 0.55,curve: 'linear', tension: 0 },
        { beat: 64,  value: 0.7, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.85,curve: 'linear', tension: 0 },
        { beat: 192, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.65,curve: 'linear', tension: 0 },
        { beat: TB,  value: 0.05,curve: 'linear', tension: 0 },
    ];

    // Kick volume: ghost → full
    const kickVolLane = createAutomationLane(kickTrack.id, 'volume', 'Volume', 0, 1);
    kickVolLane.points = [
        { beat: 32,  value: 0.3, curve: 'linear', tension: 0 },
        { beat: 64,  value: 0.65,curve: 'linear', tension: 0 },
        { beat: 128, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 224, value: 0,   curve: 'linear', tension: 0 }, // hard cut at breakdown
        { beat: 256, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.9, curve: 'linear', tension: 0 },
    ];

    // Strings: fade in, prominent in catharsis, fade out
    const strVolLane = createAutomationLane(stringsTrack.id, 'volume', 'Volume', 0, 1);
    strVolLane.points = [
        { beat: 64,  value: 0.0, curve: 'linear', tension: 0 },
        { beat: 96,  value: 0.5, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.85,curve: 'linear', tension: 0 },
        { beat: 192, value: 0,   curve: 'linear', tension: 0 },
        { beat: 224, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB,  value: 0,   curve: 'linear', tension: 0 },
    ];

    // Arp: enters crisply, silent in breakdown
    const arpVolLane = createAutomationLane(arpTrack.id, 'volume', 'Volume', 0, 1);
    arpVolLane.points = [
        { beat: 64,  value: 0,   curve: 'linear', tension: 0 },
        { beat: 80,  value: 0.7, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.85,curve: 'linear', tension: 0 },
        { beat: 192, value: 0,   curve: 'linear', tension: 0 },
        { beat: 240, value: 0.65,curve: 'linear', tension: 0 },
        { beat: 288, value: 0.5, curve: 'linear', tension: 0 },
        { beat: TB,  value: 0,   curve: 'linear', tension: 0 },
    ];

    // Lead: appears and disappears
    const leadVolLane = createAutomationLane(leadTrack.id, 'volume', 'Volume', 0, 1);
    leadVolLane.points = [
        { beat: 128, value: 0,   curve: 'linear', tension: 0 },
        { beat: 132, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 192, value: 0,   curve: 'linear', tension: 0 },
        { beat: 256, value: 0.75,curve: 'linear', tension: 0 },
        { beat: 288, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB,  value: 0,   curve: 'linear', tension: 0 },
    ];

    // Piano: very soft bookend, solo in breakdown
    const pianoVolLane = createAutomationLane(pianoTrack.id, 'volume', 'Volume', 0, 1);
    pianoVolLane.points = [
        { beat: 0,   value: 0.7, curve: 'linear', tension: 0 },
        { beat: 32,  value: 0,   curve: 'linear', tension: 0 }, // fades as groove enters
        { beat: 192, value: 0.85,curve: 'linear', tension: 0 }, // solo in breakdown
        { beat: 224, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 288, value: 0.7, curve: 'linear', tension: 0 }, // returns in outro
        { beat: TB,  value: 0,   curve: 'linear', tension: 0 },
    ];

    // Hat panning sweep — slow wide auto-pan
    const hatPanLane = createAutomationLane(hatCTrack.id, 'pan', 'Pan', -1, 1);
    hatPanLane.points = [];
    for (let b = 64; b <= TB; b += 8) {
        hatPanLane.points.push({ beat: b, value: (b / 8) % 2 === 0 ? 0.28 : -0.28, curve: 'linear', tension: 0 });
    }

    // Pulse bass filter sweep — filter opens up over the song
    const pulseFilterLane = createAutomationLane(pulseTrack.id, 'filterCutoff', 'Filter Cutoff', 20, 20000);
    pulseFilterLane.points = [
        { beat: 32,  value: 180,  curve: 'linear', tension: 0 },
        { beat: 64,  value: 500,  curve: 'linear', tension: 0 },
        { beat: 128, value: 2400, curve: 'linear', tension: 0 },
        { beat: 160, value: 4800, curve: 'linear', tension: 0 },
        { beat: 192, value: 300,  curve: 'linear', tension: 0 },
        { beat: 224, value: 1200, curve: 'linear', tension: 0 },
        { beat: 256, value: 6000, curve: 'linear', tension: 0 },
        { beat: 288, value: 2000, curve: 'linear', tension: 0 },
        { beat: TB,  value: 200,  curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [subVolLane, padVolLane, kickVolLane, strVolLane, arpVolLane,
                leadVolLane, pianoVolLane, hatPanLane, pulseFilterLane],
    });

    // ---- MARKERS ----
    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0,   name: 'Intro',      color: '#6366f1' },
            { id: crypto.randomUUID(), beat: 32,  name: 'Emergence',  color: '#8b5cf6' },
            { id: crypto.randomUUID(), beat: 64,  name: 'Groove',     color: '#3b82f6' },
            { id: crypto.randomUUID(), beat: 128, name: 'Catharsis',  color: '#ef4444' },
            { id: crypto.randomUUID(), beat: 192, name: 'Breakdown',  color: '#f59e0b' },
            { id: crypto.randomUUID(), beat: 224, name: 'Rise',       color: '#10b981' },
            { id: crypto.randomUUID(), beat: 288, name: 'Outro',      color: '#6366f1' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0,   endBeat: 32,  name: 'Intro',     color: '#6366f1' },
            { id: crypto.randomUUID(), startBeat: 32,  endBeat: 64,  name: 'Emergence', color: '#8b5cf6' },
            { id: crypto.randomUUID(), startBeat: 64,  endBeat: 128, name: 'Groove',    color: '#3b82f6' },
            { id: crypto.randomUUID(), startBeat: 128, endBeat: 192, name: 'Catharsis', color: '#ef4444' },
            { id: crypto.randomUUID(), startBeat: 192, endBeat: 224, name: 'Breakdown', color: '#f59e0b' },
            { id: crypto.randomUUID(), startBeat: 224, endBeat: 288, name: 'Rise',      color: '#10b981' },
            { id: crypto.randomUUID(), startBeat: 288, endBeat: TB,  name: 'Outro',     color: '#6366f1' },
        ],
    });

    syncArrangement(tracks);
    projectStore.set({ name: 'Resonance (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false });
}


// ---------------------------------------------------------------------------
// Demo Project 2: Electronic Beat
// ---------------------------------------------------------------------------

export async function demo2_ElectronicBeat(): Promise<void> {
    const bpm = 110;
    const totalBeats = 128;

    // Group Tracks
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    const drumFolder = createTrack({ name: 'Drums', kind: 'folder' });
    const bassFolder = createTrack({ name: 'Bass', kind: 'folder' });
    const synthFolder = createTrack({ name: 'Synths', kind: 'folder' });
    const fxFolder = createTrack({ name: 'FX', kind: 'folder' });

    // Drum Tracks
    const kickTrack = createTrack({ name: 'Kick', kind: 'audio', parentId: drumFolder.id });
    const snareTrack = createTrack({ name: 'Snare', kind: 'audio', parentId: drumFolder.id });
    const hatClosedTrack = createTrack({ name: 'Hat Closed', kind: 'audio', parentId: drumFolder.id });

    // Bass Tracks
    const subBassTrack = createTrack({ name: 'Sub Bass', kind: 'midi', parentId: bassFolder.id });
    const midBassTrack = createTrack({ name: 'FM Bass', kind: 'midi', parentId: bassFolder.id });

    // Synth Tracks
    const padTrack = createTrack({ name: 'Juno Pad', kind: 'midi', parentId: synthFolder.id });
    const arp1Track = createTrack({ name: 'Pluck Arp', kind: 'midi', parentId: synthFolder.id });
    const lead1Track = createTrack({ name: 'Main Lead', kind: 'midi', parentId: synthFolder.id });

    // FX Tracks
    const riserTrack = createTrack({ name: 'Riser', kind: 'audio', parentId: fxFolder.id });

    applyPreset(subBassTrack, 'factory-bass-sub');
    applyPreset(midBassTrack, 'factory-bass-analog');
    applyPreset(padTrack, 'factory-pad-warm');
    applyPreset(arp1Track, 'factory-keys-pluck');
    applyPreset(lead1Track, 'factory-lead-classic');

    // Pan some

    const ctxId = Date.now();
    await Promise.all([
        generateDemoDrumBuffer(`d2-kick-${ctxId}`, totalBeats, bpm, 'kick'),
        generateDemoDrumBuffer(`d2-snare-${ctxId}`, totalBeats, bpm, 'snare'),
        generateDemoDrumBuffer(`d2-hat-${ctxId}`, totalBeats, bpm, 'hat'),
        generateSyntheticToneBuffer(`d2-riser-${ctxId}`, 16, bpm, 800),
        generateSyntheticToneBuffer(`d2-vox-${ctxId}`, totalBeats, bpm, 400),
    ]);

    // We reuse buffers for some
    const kickClip = createAudioClip(kickTrack.id, 'Synthwave Kick', 0, totalBeats, `d2-kick-${ctxId}`);
    const snareClip = createAudioClip(snareTrack.id, 'Gated Snare', 0, totalBeats, `d2-snare-${ctxId}`);
    const hatClip = createAudioClip(hatClosedTrack.id, '16th Hats', 0, totalBeats, `d2-hat-${ctxId}`);
    const riserClip = createAudioClip(riserTrack.id, 'Riser', 48, 64, `d2-riser-${ctxId}`);
    riserClip.fadeInBeats = 16;

    kickTrack.clips = [kickClip];
    snareTrack.clips = [snareClip];
    hatClosedTrack.clips = [hatClip];
    riserTrack.clips = [riserClip];

    const subClip = createMidiClip(subBassTrack.id, 'Rolling Bass', 0, totalBeats);
    const midBassClip = createMidiClip(midBassTrack.id, 'Stabs', 0, totalBeats);
    const padClip = createMidiClip(padTrack.id, 'Chord Progression', 0, totalBeats);
    const arpClip = createMidiClip(arp1Track.id, 'Arp Pattern', 16, totalBeats);
    const leadClip = createMidiClip(lead1Track.id, 'Nostalgic Melody', 32, totalBeats);

    subBassTrack.clips = [subClip];
    midBassTrack.clips = [midBassClip];
    padTrack.clips = [padClip];
    arp1Track.clips = [arpClip];
    lead1Track.clips = [leadClip];

    const subNotes: MidiNote[] = [];
    const midBassNotes: MidiNote[] = [];
    const padNotes: MidiNote[] = [];
    const arpNotes: MidiNote[] = [];
    const leadNotes: MidiNote[] = [];

    for (let beat = 0; beat < totalBeats; beat++) {
        // Progression: Am, F, C, G
        const bar = Math.floor(beat / 16);
        const chordIdx = bar % 4;
        let root = 45; // A2
        if (chordIdx === 1) {
            root = 41;
        } // F2
        if (chordIdx === 2) {
            root = 48;
        } // C3
        if (chordIdx === 3) {
            root = 43;
        } // G2

        // Fast pedaling sub bass
        if (beat % 0.5 === 0) {
            subNotes.push(note(root - 12, beat, 0.4, 90 + Math.random() * 10));
        }

        // Mid bass stabs on offbeats
        if (beat % 2 === 1.5) {
            midBassNotes.push(note(root, beat, 0.25, 100));
        }

        // Pads
        if (beat % 16 === 0) {
            padNotes.push(note(root, beat, 16, 60));
            padNotes.push(note(root + 3, beat, 16, 60));
            padNotes.push(note(root + 7, beat, 16, 60));
        }

        // Arps
        if (beat >= 16 && beat % 0.25 === 0) {
            const arpPitch = root + ((beat * 4) % 3 === 0 ? 12 : 19);
            arpNotes.push(note(arpPitch, beat, 0.2, 70));
        }

        // Melody
        if (beat >= 32 && beat % 4 === 0) {
            leadNotes.push(note(root + 24, beat, 2, 90));
            leadNotes.push(note(root + 26, beat + 2, 0.5, 80));
            leadNotes.push(note(root + 27, beat + 3, 1, 95));
        }
    }

    const tracks = [
        masterTrack,
        drumFolder,
        kickTrack,
        snareTrack,
        hatClosedTrack,
        bassFolder,
        subBassTrack,
        midBassTrack,
        synthFolder,
        padTrack,
        arp1Track,
        lead1Track,
        fxFolder,
        riserTrack,
    ];

    trackStore.set({ tracks, selectedTrackId: lead1Track.id });

    midiStore.set({
        notesByClipId: {
            [subClip.id]: subNotes,
            [midBassClip.id]: midBassNotes,
            [padClip.id]: padNotes,
            [arpClip.id]: arpNotes,
            [leadClip.id]: leadNotes,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: totalBeats, isLooping: true });

    const padVolLane = createAutomationLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVolLane.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.8, curve: 'linear', tension: 0 },
    ];
    automationStore.set({ lanes: [padVolLane] });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), beat: 32, name: 'Main Theme', color: '#ff6961' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 32, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), startBeat: 32, endBeat: 128, name: 'Main Theme', color: '#ff6961' },
        ],
    });

    syncArrangement(tracks);
    projectStore.set({ name: 'Synthwave Night (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false });
}

// ---------------------------------------------------------------------------
// Demo Project 3: Acoustic Session
// ---------------------------------------------------------------------------

export async function demo3_AcousticSession(): Promise<void> {
    const bpm = 85; // LoFi Hip Hop
    const totalBeats = 128;

    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    const drumFolder = createTrack({ name: 'Drum Break', kind: 'folder' });
    const bassFolder = createTrack({ name: 'Bass & Sub', kind: 'folder' });
    const keysFolder = createTrack({ name: 'Keys & Vinyl', kind: 'folder' });
    const fxFolder = createTrack({ name: 'Foley', kind: 'folder' });

    const kickTrack = createTrack({ name: 'Tape Kick', kind: 'audio', parentId: drumFolder.id });
    const snareTrack = createTrack({ name: 'Rim Snare', kind: 'audio', parentId: drumFolder.id });
    const hatClosedTrack = createTrack({ name: 'Vinyl Hats', kind: 'audio', parentId: drumFolder.id });
    const percTrack = createTrack({ name: 'Percussion Loop', kind: 'audio', parentId: drumFolder.id });

    const subBassTrack = createTrack({ name: 'Deep Sub', kind: 'midi', parentId: bassFolder.id });

    const rhodesTrack = createTrack({ name: 'LoFi Rhodes', kind: 'midi', parentId: keysFolder.id });
    const pianoTrack = createTrack({ name: 'Dusty Piano', kind: 'midi', parentId: keysFolder.id });

    const vinylNoiseTrack = createTrack({ name: 'Vinyl Crackle', kind: 'audio', parentId: fxFolder.id });

    applyPreset(subBassTrack, 'factory-bass-sub');
    applyPreset(rhodesTrack, 'factory-keys-epiano');
    applyPreset(pianoTrack, 'factory-keys-pluck');

    rhodesTrack.pan = -0.2;
    vinylNoiseTrack.pan = 0.1;

    const ctxId = Date.now();
    await Promise.all([
        generateDemoDrumBuffer(`d3-kick-${ctxId}`, totalBeats, bpm, 'kick'),
        generateDemoDrumBuffer(`d3-snare-${ctxId}`, totalBeats, bpm, 'snare'),
        generateDemoDrumBuffer(`d3-hat-${ctxId}`, totalBeats, bpm, 'shaker'),
        generateSyntheticToneBuffer(`d3-vinyl-${ctxId}`, totalBeats, bpm, 100),
    ]);

    const kickClip = createAudioClip(kickTrack.id, 'LoFi Kick', 0, totalBeats, `d3-kick-${ctxId}`);
    const snareClip = createAudioClip(snareTrack.id, 'Rim Shot', 0, totalBeats, `d3-snare-${ctxId}`);
    const hatClip = createAudioClip(hatClosedTrack.id, 'Lazy Hats', 0, totalBeats, `d3-hat-${ctxId}`);
    const vinylClip = createAudioClip(vinylNoiseTrack.id, 'Crackle Loop', 0, totalBeats, `d3-vinyl-${ctxId}`);
    vinylClip.gain = 0.4;

    kickTrack.clips = [kickClip];
    snareTrack.clips = [snareClip];
    hatClosedTrack.clips = [hatClip];
    vinylNoiseTrack.clips = [vinylClip];

    const subClip = createMidiClip(subBassTrack.id, 'Smooth Bass', 0, totalBeats);
    const rhodesClip = createMidiClip(rhodesTrack.id, 'Chords.tape', 0, totalBeats);
    const pianoClip = createMidiClip(pianoTrack.id, 'Muted Melody', 16, totalBeats);

    subBassTrack.clips = [subClip];
    rhodesTrack.clips = [rhodesClip];
    pianoTrack.clips = [pianoClip];

    const subNotes: MidiNote[] = [];
    const rhodesNotes: MidiNote[] = [];
    const pianoNotes: MidiNote[] = [];

    for (let beat = 0; beat < totalBeats; beat++) {
        // Jazz progression ii-V-I: Dm7 (D F A C) - G7 (G B D F) - CMaj7 (C E G B)
        const bar = Math.floor(beat / 8);
        const chordIdx = bar % 4;
        let root = 50; // D3
        let third = 53,
            fifth = 57,
            seventh = 60;

        if (chordIdx === 1) {
            // G7
            root = 43;
            third = 47;
            fifth = 50;
            seventh = 53;
        } else if (chordIdx >= 2) {
            // CMaj7
            root = 48;
            third = 52;
            fifth = 55;
            seventh = 59;
        }

        if (beat % 8 === 0) {
            subNotes.push(note(root - 24, beat + 0.1, 4, 85)); // Late bass
            subNotes.push(note(root - 24, beat + 4.1, 3, 75));

            rhodesNotes.push(note(root, beat + 0.1, 8, 70));
            rhodesNotes.push(note(third, beat + 0.12, 8, 70));
            rhodesNotes.push(note(fifth, beat + 0.14, 8, 70));
            rhodesNotes.push(note(seventh, beat + 0.16, 8, 60));
        }

        if (beat >= 16 && beat % 4 === 2) {
            pianoNotes.push(note(seventh + 12, beat + 0.2, 0.5, 80));
            pianoNotes.push(note(fifth + 12, beat + 1.2, 1, 75));
        }
    }

    const tracks = [
        masterTrack,
        drumFolder,
        kickTrack,
        snareTrack,
        hatClosedTrack,
        percTrack,
        bassFolder,
        subBassTrack,
        keysFolder,
        rhodesTrack,
        pianoTrack,
        fxFolder,
        vinylNoiseTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: rhodesTrack.id });

    midiStore.set({
        notesByClipId: { [subClip.id]: subNotes, [rhodesClip.id]: rhodesNotes, [pianoClip.id]: pianoNotes },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: totalBeats, isLooping: true });

    const vinylVolLane = createAutomationLane(vinylNoiseTrack.id, 'volume', 'Volume', 0, 1);
    vinylVolLane.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.3, curve: 'linear', tension: 0 },
    ];
    automationStore.set({ lanes: [vinylVolLane] });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), beat: 16, name: 'Vibe', color: '#77dd77' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 16, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), startBeat: 16, endBeat: 128, name: 'Vibe', color: '#77dd77' },
        ],
    });

    syncArrangement(tracks);

    projectStore.set({ name: 'LoFi Study Guide (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false });
}

// ---------------------------------------------------------------------------
// Engine Utilities
// ---------------------------------------------------------------------------

function syncArrangement(tracks: any[]) {
    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks, selectedTrackId: tracks.length > 0 ? tracks[0].id : null },
                automation: automationStore.value!,
                midi: midiStore.value!,
                tempoMap: { changes: [] },
                timeSignatureMap: { changes: [] },
                markers: markerStore.value ?? { markers: [], sections: [] },
                takeLanes: { lanes: [] },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });
}

async function generateDemoDrumBuffer(
    bufferId: string,
    beats: number,
    bpm: number,
    style: '4onFloor' | 'electro' | 'shaker' | 'kick' | 'snare' | 'hat'
): Promise<void> {
    try {
        const bps = bpm / 60;
        const durationSecs = beats / bps;
        const ctx = new OfflineAudioContext(2, Math.ceil(44100 * durationSecs), 44100);

        // Step in 16th-note resolution (0.25 beats) to hit all rhythmic positions
        for (let step = 0; step < beats * 4; step++) {
            const beat = step * 0.25;
            const time = beat / bps;
            const pos = beat % 4; // position within 4-beat bar

            if (style === 'shaker') {
                // Shaker on 8th notes
                if (step % 2 === 0) {
                    const vol = step % 4 === 0 ? 0.3 : 0.15;
                    createNoiseBurst(ctx, time, 0.05, vol, 'highpass', 4000);
                }
                continue;
            }

            // Kick: beats 0 and 2 of each bar (4-on-floor feel with a ghost on 2.5)
            const isKick =
                style === 'kick'
                    ? pos === 0 || pos === 2
                    : style === '4onFloor'
                      ? pos === 0 || pos === 2
                      : style === 'electro'
                        ? pos === 0 || pos === 2.5
                        : false;

            // Snare/clap: beats 1 and 3
            const isSnare =
                style === 'snare'
                    ? pos === 1 || pos === 3
                    : style === 'electro'
                      ? pos === 1 || pos === 3
                      : false;

            // Hi-hat: 8th notes strictly between kick and snare positions
            // Fires at 0.5, 1.5, 2.5, 3.5 — never on 0, 1, 2, 3
            const isHat =
                (style === 'hat' || style === '4onFloor') &&
                step % 2 === 2 && // every other 8th note step (positions 0.5, 1.5, 2.5, 3.5)
                pos !== 0 && pos !== 1 && pos !== 2 && pos !== 3;

            if (isKick) {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.frequency.setValueAtTime(style === 'electro' ? 120 : 150, time);
                osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
                env.gain.setValueAtTime(0.8, time);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
                osc.connect(env);
                env.connect(ctx.destination);
                osc.start(time);
                osc.stop(time + 0.3);
            }
            if (isSnare) {
                createNoiseBurst(ctx, time, 0.15, 0.6, 'highpass', 2000);
                // Add slight tone for body
                const osc2 = ctx.createOscillator();
                const env2 = ctx.createGain();
                osc2.frequency.value = 200;
                osc2.type = 'triangle';
                env2.gain.setValueAtTime(0.15, time);
                env2.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
                osc2.connect(env2);
                env2.connect(ctx.destination);
                osc2.start(time);
                osc2.stop(time + 0.1);
            }
            if (isHat) {
                createNoiseBurst(ctx, time, 0.04, 0.22, 'highpass', 9000);
            }
        }

        const rendered = await ctx.startRendering();
        audioBufferCache.set(bufferId, rendered);
    } catch {
        // OfflineAudioContext may not be available in some environments
    }
}


function createNoiseBurst(
    ctx: OfflineAudioContext,
    time: number,
    duration: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number
) {
    const noise = ctx.createBufferSource();
    const noiseBuf = ctx.createBuffer(1, Math.ceil(duration * 44100), 44100);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    noise.buffer = noiseBuf;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    noise.connect(filter);
    filter.connect(env);
    env.connect(ctx.destination);
    noise.start(time);
    noise.stop(time + duration + 0.1);
}

async function generateSyntheticToneBuffer(bufferId: string, beats: number, bpm: number, freq: number): Promise<void> {
    try {
        const bps = bpm / 60;
        const durationSecs = beats / bps;
        const ctx = new OfflineAudioContext(1, 44100 * Math.ceil(durationSecs), 44100);

        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'triangle';

        env.gain.setValueAtTime(0, 0);
        env.gain.linearRampToValueAtTime(0.4, 0.5);
        env.gain.setValueAtTime(0.4, durationSecs - 0.5);
        env.gain.linearRampToValueAtTime(0, durationSecs);

        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(0);
        osc.stop(durationSecs);

        const rendered = await ctx.startRendering();
        audioBufferCache.set(bufferId, rendered);
    } catch {
        // Ignored
    }
}
