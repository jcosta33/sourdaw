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

function createAudioClip(trackId: string, name: string, startBeat: number, endBeat: number, bufferId: string, color = '') {
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
        color,
        locked: false,
        muted: false,
        stretchMode: 'repitch' as StretchMode,
    };
}

function createMidiClip(trackId: string, name: string, startBeat: number, endBeat: number, color = '') {
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
        color,
        locked: false,
        muted: false,
    };
}

// ---------------------------------------------------------------------------
// Demo Project 1: Kiasmos-style Ambient/IDM — "Resonance"
// Key: D minor | BPM: 120 | ~5:20 (640 beats)
// Structure: Intro(0-32) → Emergence(32-64) → Build(64-128) →
//            Groove(128-224) → Catharsis(224-320) → Breakdown(320-384) →
//            Final Rise(384-512) → Outro(512-640)
// ---------------------------------------------------------------------------

export async function demo1_TheCompleteMix(): Promise<void> {
    const bpm = 120;
    const TB = 640; // totalBeats — ~5:20

    // D minor aeolian: D E F G A Bb C
    // Chord cycle (16 beats each): Dm7 → Gm7 → Am7 → Bbmaj7
    const CHORDS = [
        { sub: 26, root: 38, third: 41, fifth: 45, seventh: 48, ninth: 52 }, // Dm7(9)
        { sub: 31, root: 43, third: 46, fifth: 50, seventh: 53, ninth: 55 }, // Gm7(9)
        { sub: 33, root: 45, third: 48, fifth: 52, seventh: 55, ninth: 57 }, // Am7(9)
        { sub: 34, root: 46, third: 50, fifth: 53, seventh: 57, ninth: 60 }, // Bbmaj7(9)
    ];
    const ch = (beat: number) => CHORDS[Math.floor(beat / 16) % 4]!;
    const hv = (base: number, r = 8) => Math.max(10, Math.min(127, Math.round(base + (Math.random() - 0.5) * r * 2)));

    // ── TRACKS: 28 tracks in 6 folders ────────────────────────────────────
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    // 🥁 Drums folder
    const drumFolder = createTrack({ name: '🥁 Drums', kind: 'folder' });
    const drumKitTrack = createTrack({ name: '808 Kit', kind: 'midi', parentId: drumFolder.id });
    const percShakerTrack = createTrack({ name: 'Perc Shaker', kind: 'audio', parentId: drumFolder.id });
    const percHitsTrack = createTrack({ name: 'Perc Hits', kind: 'audio', parentId: drumFolder.id });

    // 🎸 Bass folder
    const bassFolder = createTrack({ name: '🎸 Bass', kind: 'folder' });
    const subBassTrack = createTrack({ name: 'Sub Bass', kind: 'midi', parentId: bassFolder.id });
    const bassSynthTrack = createTrack({ name: '808 Bass', kind: 'midi', parentId: bassFolder.id });
    const pulseBassTrack = createTrack({ name: 'Pulse Bass', kind: 'midi', parentId: bassFolder.id });

    // 🎹 Keys folder
    const keysFolder = createTrack({ name: '🎹 Keys', kind: 'folder' });
    const pianoTrack = createTrack({ name: 'Piano', kind: 'midi', parentId: keysFolder.id });
    const rhodesTrack = createTrack({ name: 'Rhodes', kind: 'midi', parentId: keysFolder.id });
    const organTrack = createTrack({ name: 'Organ', kind: 'midi', parentId: keysFolder.id });

    // 🎻 Strings & Pads folder
    const strPadFolder = createTrack({ name: '🎻 Strings & Pads', kind: 'folder' });
    const warmPadTrack = createTrack({ name: 'Warm Pad', kind: 'midi', parentId: strPadFolder.id });
    const shimmerPadTrack = createTrack({ name: 'Shimmer Pad', kind: 'midi', parentId: strPadFolder.id });
    const darkPadTrack = createTrack({ name: 'Dark Pad', kind: 'midi', parentId: strPadFolder.id });
    const stringsSoftTrack = createTrack({ name: 'Strings Soft', kind: 'midi', parentId: strPadFolder.id });
    const stringsBrightTrack = createTrack({ name: 'Strings Bright', kind: 'midi', parentId: strPadFolder.id });

    // 🎵 Leads folder
    const leadsFolder = createTrack({ name: '🎵 Leads & Melody', kind: 'folder' });
    const leadClassicTrack = createTrack({ name: 'Lead Classic', kind: 'midi', parentId: leadsFolder.id });
    const leadSoftTrack = createTrack({ name: 'Lead Soft', kind: 'midi', parentId: leadsFolder.id });
    const brassTrack = createTrack({ name: 'Brass', kind: 'midi', parentId: leadsFolder.id });
    const arpTrack = createTrack({ name: 'Arp Pluck', kind: 'midi', parentId: leadsFolder.id });

    // 🔊 FX folder
    const fxFolder = createTrack({ name: '🔊 FX & Mix', kind: 'folder' });
    const riserTrack = createTrack({ name: 'Riser', kind: 'midi', parentId: fxFolder.id });
    const noiseSweepTrack = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const reverbBusTrack = createTrack({ name: 'Reverb Bus', kind: 'bus' });

    // ── PRESETS ────────────────────────────────────────────────────────────
    // 808 Kit: type must be builtin-drum-kit for the drum engine
    drumKitTrack.devices = [{
        id: `dev-${crypto.randomUUID()}`, name: '808 Kit', type: 'builtin-drum-kit',
        bypassed: false, parameterValues: { kit: 0 },
    }];
    applyPreset(subBassTrack, 'factory-bass-sub');
    applyPreset(bassSynthTrack, 'factory-bass-acid');
    applyPreset(pulseBassTrack, 'factory-bass-analog');
    applyPreset(pianoTrack, 'factory-keys-pluck');
    applyPreset(rhodesTrack, 'factory-keys-bell');
    applyPreset(organTrack, 'factory-keys-organ');
    applyPreset(warmPadTrack, 'factory-pad-warm');
    applyPreset(shimmerPadTrack, 'factory-pad-shimmer');
    applyPreset(darkPadTrack, 'factory-pad-dark');
    applyPreset(stringsSoftTrack, 'factory-strings-soft');
    applyPreset(stringsBrightTrack, 'factory-strings-bright');
    applyPreset(leadClassicTrack, 'factory-lead-classic');
    applyPreset(leadSoftTrack, 'factory-lead-soft');
    applyPreset(brassTrack, 'factory-synth-brass');
    applyPreset(arpTrack, 'factory-synth-arp');
    applyPreset(riserTrack, 'factory-fx-riser');
    applyPreset(noiseSweepTrack, 'factory-fx-noise-sweep');

    // ── GAIN / PAN — stereo field ─────────────────────────────────────────
    drumKitTrack.gain = 0.88; drumKitTrack.pan = 0;
    percShakerTrack.gain = 0.38; percShakerTrack.pan = 35;
    percHitsTrack.gain = 0.42; percHitsTrack.pan = -25;
    subBassTrack.gain = 0.90; subBassTrack.pan = 0;
    bassSynthTrack.gain = 0.72; bassSynthTrack.pan = 5;
    pulseBassTrack.gain = 0.65; pulseBassTrack.pan = 8;
    pianoTrack.gain = 0.68; pianoTrack.pan = -22;
    rhodesTrack.gain = 0.55; rhodesTrack.pan = 18;
    organTrack.gain = 0.45; organTrack.pan = -8;
    warmPadTrack.gain = 0.72; warmPadTrack.pan = 12;
    shimmerPadTrack.gain = 0.48; shimmerPadTrack.pan = -30;
    darkPadTrack.gain = 0.55; darkPadTrack.pan = 20;
    stringsSoftTrack.gain = 0.58; stringsSoftTrack.pan = -15;
    stringsBrightTrack.gain = 0.52; stringsBrightTrack.pan = 25;
    leadClassicTrack.gain = 0.72; leadClassicTrack.pan = -8;
    leadSoftTrack.gain = 0.58; leadSoftTrack.pan = 15;
    brassTrack.gain = 0.62; brassTrack.pan = 5;
    arpTrack.gain = 0.55; arpTrack.pan = 32;
    riserTrack.gain = 0.50; riserTrack.pan = 0;
    noiseSweepTrack.gain = 0.40; noiseSweepTrack.pan = 0;

    // ── AUDIO DRUM BUFFERS ────────────────────────────────────────────────
    const cx = Date.now();
    const bShaker = `d1-shaker-${cx}`, bPerc = `d1-perc-${cx}`;
    await Promise.all([
        generateDemoDrumBuffer(bShaker, TB, bpm, 'shaker'),
        generateDemoDrumBuffer(bPerc, TB, bpm, 'hat'),
    ]);

    // ── CLIPS ─────────────────────────────────────────────────────────────
    // 808 Kit MIDI clips (multiple clips per section for arrangement control)
    const dk1 = createMidiClip(drumKitTrack.id, 'Kit Build', 64, 128, drumKitTrack.color);
    const dk2 = createMidiClip(drumKitTrack.id, 'Kit Groove', 128, 224, drumKitTrack.color);
    const dk3 = createMidiClip(drumKitTrack.id, 'Kit Catharsis', 224, 320, drumKitTrack.color);
    const dk4 = createMidiClip(drumKitTrack.id, 'Kit Rise', 384, 512, drumKitTrack.color);
    const dk5 = createMidiClip(drumKitTrack.id, 'Kit Outro', 512, 576, drumKitTrack.color);
    drumKitTrack.clips = [dk1, dk2, dk3, dk4, dk5];

    // Audio perc
    const shakerA = createAudioClip(percShakerTrack.id, 'Shaker A', 96, 320, bShaker, percShakerTrack.color);
    const shakerB = createAudioClip(percShakerTrack.id, 'Shaker B', 384, 576, bShaker, percShakerTrack.color);
    percShakerTrack.clips = [shakerA, shakerB];

    const percA = createAudioClip(percHitsTrack.id, 'Perc Hits A', 128, 320, bPerc, percHitsTrack.color);
    const percB = createAudioClip(percHitsTrack.id, 'Perc Hits B', 384, 512, bPerc, percHitsTrack.color);
    percHitsTrack.clips = [percA, percB];

    // Bass clips
    const subClip = createMidiClip(subBassTrack.id, 'Sub Drone', 0, TB, subBassTrack.color);
    const bass808Clip = createMidiClip(bassSynthTrack.id, '808 Bass Line', 64, TB, bassSynthTrack.color);
    const pulseClip = createMidiClip(pulseBassTrack.id, 'Pulse Seq', 32, TB, pulseBassTrack.color);
    subBassTrack.clips = [subClip];
    bassSynthTrack.clips = [bass808Clip];
    pulseBassTrack.clips = [pulseClip];

    // Keys clips
    const pianoIntro = createMidiClip(pianoTrack.id, 'Piano Intro', 0, 64, pianoTrack.color);
    pianoIntro.fadeInBeats = 2;
    const pianoBD = createMidiClip(pianoTrack.id, 'Piano Breakdown', 320, 384, pianoTrack.color);
    const pianoOutro = createMidiClip(pianoTrack.id, 'Piano Outro', 512, TB, pianoTrack.color);
    pianoOutro.fadeOutBeats = 8;
    pianoTrack.clips = [pianoIntro, pianoBD, pianoOutro];

    const rhodesClip = createMidiClip(rhodesTrack.id, 'Rhodes Chords', 64, 512, rhodesTrack.color);
    rhodesTrack.clips = [rhodesClip];

    const organClip = createMidiClip(organTrack.id, 'Organ Sustain', 128, 320, organTrack.color);
    organTrack.clips = [organClip];

    // Strings & Pads clips
    const warmPadClip = createMidiClip(warmPadTrack.id, 'Warm Pad', 0, TB, warmPadTrack.color);
    warmPadTrack.clips = [warmPadClip];

    const shimmerClip = createMidiClip(shimmerPadTrack.id, 'Shimmer', 128, 512, shimmerPadTrack.color);
    shimmerPadTrack.clips = [shimmerClip];

    const darkClip = createMidiClip(darkPadTrack.id, 'Dark Tension', 192, 384, darkPadTrack.color);
    darkPadTrack.clips = [darkClip];

    const strSoftClip = createMidiClip(stringsSoftTrack.id, 'Strings Soft', 64, TB, stringsSoftTrack.color);
    stringsSoftTrack.clips = [strSoftClip];

    const strBrightClip = createMidiClip(stringsBrightTrack.id, 'Strings Catharsis', 224, 320, stringsBrightTrack.color);
    stringsBrightTrack.clips = [strBrightClip];

    // Lead clips
    const leadClip = createMidiClip(leadClassicTrack.id, 'Lead Motif', 160, TB, leadClassicTrack.color);
    leadClassicTrack.clips = [leadClip];

    const leadSoftClip = createMidiClip(leadSoftTrack.id, 'Lead Answer', 224, 512, leadSoftTrack.color);
    leadSoftTrack.clips = [leadSoftClip];

    const brassClip = createMidiClip(brassTrack.id, 'Brass Fanfare', 224, 320, brassTrack.color);
    brassTrack.clips = [brassClip];

    const arpClip = createMidiClip(arpTrack.id, 'Arp 16th', 64, TB, arpTrack.color);
    arpTrack.clips = [arpClip];

    // FX clips
    const riserClip1 = createMidiClip(riserTrack.id, 'Pre-Catharsis Rise', 192, 224, riserTrack.color);
    riserClip1.fadeInBeats = 16;
    const riserClip2 = createMidiClip(riserTrack.id, 'Pre-Final Rise', 352, 384, riserTrack.color);
    riserClip2.fadeInBeats = 16;
    riserTrack.clips = [riserClip1, riserClip2];

    const noiseClip1 = createMidiClip(noiseSweepTrack.id, 'Sweep Build', 192, 224, noiseSweepTrack.color);
    const noiseClip2 = createMidiClip(noiseSweepTrack.id, 'Sweep Final', 352, 384, noiseSweepTrack.color);
    noiseSweepTrack.clips = [noiseClip1, noiseClip2];

    // ── MIDI NOTE GENERATION ──────────────────────────────────────────────
    // 808 DRUM KIT NOTES — using GM drum map (kick=36, snare=38, clap=39, etc.)
    const drumN: MidiNote[] = [];
    // Sections where drums play: Build(64-128 sparse), Groove(128-224), Catharsis(224-320),
    //                            Rise(384-512), Outro(512-576 fading)
    for (let b = 64; b < 576; b += 0.25) {
        if (b >= 320 && b < 384) continue; // breakdown silence
        const pos = b % 4;
        const inBuild = b < 128;
        const inCatharsis = b >= 224 && b < 320;
        const inOutro = b >= 512;

        // Kick: 4-on-floor (every beat), or half-time in build/outro
        if (pos === 0 || (!inBuild && !inOutro && pos === 2)) {
            drumN.push(note(36, b, 0.5, hv(inBuild ? 70 : inCatharsis ? 110 : 95, 8)));
        }
        // Ghost kick on "and" of 3 in groove/catharsis
        if (!inBuild && !inOutro && pos === 2.75) {
            drumN.push(note(36, b, 0.25, hv(55, 10)));
        }
        // Snare/Clap on 1 and 3
        if (!inBuild && (pos === 1 || pos === 3)) {
            drumN.push(note(inCatharsis ? 39 : 38, b, 0.5, hv(inCatharsis ? 105 : 90, 8)));
        }
        // Build: snare only on 3
        if (inBuild && pos === 3) {
            drumN.push(note(38, b, 0.5, hv(72, 8)));
        }
        // Closed HH: 16ths in groove/catharsis, 8ths in build
        if (!inBuild && pos % 0.25 === 0) {
            const isAccent = pos % 1 === 0;
            drumN.push(note(42, b, 0.15, hv(isAccent ? 75 : 50, 12)));
        } else if (inBuild && pos % 0.5 === 0) {
            drumN.push(note(42, b, 0.2, hv(62, 10)));
        }
        // Open HH: beats 0.5, 2.5 (offbeats) in catharsis only
        if (inCatharsis && (pos === 0.5 || pos === 2.5)) {
            drumN.push(note(46, b, 0.3, hv(68, 8)));
        }
        // Toms: fills at phrase boundaries (every 32 beats, last 2 beats)
        if (b % 32 >= 30 && pos % 0.5 === 0 && !inOutro) {
            const tomPitches = [43, 47, 50]; // low, mid, high
            drumN.push(note(tomPitches[Math.floor(((b % 2) / 0.5)) % 3]!, b, 0.25, hv(85, 10)));
        }
        // Cowbell: sparse accents in catharsis
        if (inCatharsis && b % 8 === 0) {
            drumN.push(note(56, b + 0.5, 0.25, hv(60, 8)));
        }
    }

    // SUB BASS — deep root drone every 2 beats
    const subN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 2) {
        const c = ch(b);
        const inBD = b >= 320 && b < 384;
        const vel = b < 16 ? 40 : b < 32 ? 55 : b < 64 ? 68 : inBD ? 45 : b >= 512 ? 55 : 82;
        subN.push(note(c.sub, b, 1.95, hv(vel, 5)));
        if (b % 16 === 14 && !inBD && b >= 64 && b < 512) {
            subN.push(note(c.sub + 12, b + 0.5, 0.4, hv(85, 10)));
        }
    }

    // 808 BASS — melodic acid-style line, enters at build
    const bass808N: MidiNote[] = [];
    for (let b = 64; b < TB; b += 4) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b >= 224 && b < 320 ? 95 : b >= 512 ? 60 : 78;
        bass808N.push(note(c.root, b, 0.8, hv(vel, 6)));
        bass808N.push(note(c.fifth, b + 1.5, 0.4, hv(vel - 10, 8)));
        bass808N.push(note(c.root, b + 2, 0.6, hv(vel - 5, 6)));
        bass808N.push(note(c.third, b + 3, 0.8, hv(vel - 8, 8)));
    }

    // PULSE BASS — syncopated 8th-note pattern
    const pulseN: MidiNote[] = [];
    const pulseOffsets = [0, 0.5, 1.5, 2, 3, 3.5];
    for (let bar = 8; bar < TB / 4; bar++) {
        const b = bar * 4;
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b < 64 ? 0.7 : b >= 512 ? 0.75 : 1.0;
        for (const off of pulseOffsets) {
            const bt = b + off;
            const isAcc = off === 0 || off === 2;
            const pitch = off === 0.5 || off === 1.5 ? c.fifth : c.root;
            pulseN.push(note(pitch, bt, 0.4, hv(Math.round((isAcc ? 88 : 65) * vel), 10)));
        }
    }

    // PIANO — sparse bookend, breakdown solo
    const pianoN: MidiNote[] = [];
    const pianoSparse = (startBeat: number, c: (typeof CHORDS)[0], velBase: number) => {
        pianoN.push(note(c.root + 24, startBeat, 1.5, hv(velBase, 8)));
        pianoN.push(note(c.fifth + 24, startBeat + 2, 1.0, hv(velBase - 8, 8)));
        pianoN.push(note(c.third + 24, startBeat + 4, 2.0, hv(velBase - 4, 10)));
        pianoN.push(note(c.seventh + 24, startBeat + 7, 1.5, hv(velBase - 12, 10)));
    };
    for (let b = 2; b < 64; b += 8) pianoSparse(b, ch(b), 48);
    for (let b = 320; b < 384; b += 8) pianoSparse(b, ch(b), 62);
    for (let b = 512; b < TB; b += 16) {
        const c = ch(b);
        pianoN.push(note(c.root + 24, b, 7.5, hv(55, 6)));
        pianoN.push(note(c.third + 24, b + 0.1, 7.5, hv(48, 6)));
        pianoN.push(note(c.seventh + 24, b + 0.2, 7.5, hv(42, 6)));
    }

    // RHODES — warm chords in groove sections
    const rhodesN: MidiNote[] = [];
    for (let b = 64; b < 512; b += 16) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b < 128 ? 52 : b >= 224 ? 65 : 58;
        rhodesN.push(note(c.root + 12, b + 0.05, 15.5, hv(vel, 6)));
        rhodesN.push(note(c.third + 12, b + 0.08, 15.5, hv(vel - 4, 6)));
        rhodesN.push(note(c.fifth + 12, b + 0.12, 15.5, hv(vel - 8, 8)));
        rhodesN.push(note(c.seventh + 12, b + 0.15, 15.5, hv(vel - 12, 8)));
    }

    // ORGAN — sustained texture in mid-sections
    const organN: MidiNote[] = [];
    for (let b = 128; b < 320; b += 32) {
        const c = ch(b);
        organN.push(note(c.root + 12, b, 31, hv(42, 6)));
        organN.push(note(c.fifth + 12, b, 31, hv(38, 6)));
    }

    // WARM PAD — evolving from intro to outro
    const warmPadN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 16) {
        const c = ch(b);
        const inBD = b >= 320 && b < 384;
        const vel = b < 16 ? 32 : b < 64 ? 48 : inBD ? 38 : b >= 512 ? 50 : 68;
        const dur = inBD ? 14 : 15.8;
        warmPadN.push(note(c.root + 12, b, dur, hv(vel, 6)));
        warmPadN.push(note(c.third + 12, b, dur, hv(vel - 4, 6)));
        warmPadN.push(note(c.fifth + 12, b, dur, hv(vel - 8, 8)));
        warmPadN.push(note(c.seventh + 12, b, dur, hv(vel - 12, 8)));
        if (b >= 128 && !inBD) {
            warmPadN.push(note(c.root + 24, b, dur, hv(vel - 20, 10)));
        }
    }

    // SHIMMER PAD — high ethereal in intense sections
    const shimmerN: MidiNote[] = [];
    for (let b = 128; b < 512; b += 16) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b >= 224 && b < 320 ? 58 : 45;
        shimmerN.push(note(c.ninth + 24, b, 15.8, hv(vel, 10)));
        shimmerN.push(note(c.root + 36, b, 15.8, hv(vel - 15, 10)));
    }

    // DARK PAD — tension builder before catharsis & final rise
    const darkN: MidiNote[] = [];
    for (let b = 192; b < 384; b += 8) {
        const c = ch(b);
        const vel = b < 224 ? 35 + Math.floor((b - 192) * 1.5) : b >= 320 ? 45 : 55;
        darkN.push(note(c.root, b, 7.5, hv(vel, 8)));
        darkN.push(note(c.fifth, b, 7.5, hv(vel - 10, 8)));
    }

    // STRINGS SOFT — counter-voice, enters at build
    const strSoftN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 16) {
        if (b >= 320 && b < 384) continue;
        if (b >= 576) continue;
        const c = ch(b);
        const vel = b < 128 ? 48 : b >= 384 ? 58 : 62;
        strSoftN.push(note(c.fifth + 12, b + 0.5, 15, hv(vel, 8)));
        strSoftN.push(note(c.ninth + 12, b + 0.5, 15, hv(vel - 6, 8)));
        strSoftN.push(note(c.root + 24, b + 8, 7, hv(vel - 10, 10)));
    }

    // STRINGS BRIGHT — catharsis power
    const strBrightN: MidiNote[] = [];
    for (let b = 224; b < 320; b += 8) {
        const c = ch(b);
        strBrightN.push(note(c.root + 24, b, 7.5, hv(72, 8)));
        strBrightN.push(note(c.third + 24, b, 7.5, hv(68, 8)));
        strBrightN.push(note(c.fifth + 24, b, 7.5, hv(64, 8)));
        strBrightN.push(note(c.seventh + 24, b, 7.5, hv(60, 8)));
    }

    // LEAD CLASSIC — main melody in catharsis and finale
    const leadMotif = [
        [0, 62, 2.0, 92], [2, 65, 1.0, 80], [3, 67, 0.5, 75], [3.5, 69, 1.5, 88],
        [5, 67, 1.0, 70], [6, 65, 2.0, 82], [8, 72, 3.0, 95], [11, 69, 1.0, 78],
        [12, 67, 0.5, 72], [12.5, 65, 3.5, 85],
    ] as const;
    const leadN: MidiNote[] = [];
    // First appearance: groove entry (beat 160)
    for (let phrase = 0; phrase < 4; phrase++) {
        const base = 160 + phrase * 16;
        for (const [off, pitch, dur, vel] of leadMotif) {
            leadN.push(note(pitch, base + off, dur, hv(vel, 8)));
        }
    }
    // Catharsis: full lead + higher register
    for (let phrase = 0; phrase < 6; phrase++) {
        const base = 224 + phrase * 16;
        const shift = phrase >= 4 ? 12 : 0;
        for (const [off, pitch, dur, vel] of leadMotif) {
            leadN.push(note(pitch + shift, base + off, dur, hv(vel + 5, 8)));
        }
    }
    // Final rise: octave up
    for (let phrase = 0; phrase < 4; phrase++) {
        const base = 416 + phrase * 16;
        for (const [off, pitch, dur, vel] of leadMotif) {
            leadN.push(note(pitch + 12, base + off, dur, hv(vel, 10)));
        }
    }

    // LEAD SOFT — answer phrase, fills between classic lead
    const leadSoftN: MidiNote[] = [];
    const answerMotif = [
        [0, 69, 1.5, 68], [2, 72, 2.0, 75], [4, 74, 1.0, 65],
        [5, 72, 1.5, 70], [7, 69, 2.5, 60],
    ] as const;
    for (let b = 232; b < 512; b += 32) {
        if (b >= 320 && b < 384) continue;
        for (const [off, pitch, dur, vel] of answerMotif) {
            leadSoftN.push(note(pitch, b + off, dur, hv(vel, 10)));
        }
    }

    // BRASS — catharsis fanfare only
    const brassN: MidiNote[] = [];
    for (let b = 224; b < 320; b += 16) {
        const c = ch(b);
        brassN.push(note(c.root + 24, b + 4, 3.5, hv(80, 8)));
        brassN.push(note(c.fifth + 24, b + 4, 3.5, hv(75, 8)));
        brassN.push(note(c.root + 24, b + 8, 7.5, hv(90, 10)));
        brassN.push(note(c.third + 24, b + 8, 7.5, hv(85, 10)));
    }

    // ARP — chord-tone 16th-note sequence
    const ARP_POOLS: number[][] = [
        [62, 65, 69, 72, 74], [67, 70, 74, 77],
        [69, 72, 76, 79], [70, 74, 77, 81],
    ];
    const ARP_STEPS = [0, 2, 1, 3, 2, 4, 3, 1];
    const arpN: MidiNote[] = [];
    let arpStep = 0;
    for (let b = 64; b < TB; b += 0.25) {
        if (b >= 320 && b < 384) continue;
        if (b >= 576) continue;
        const chordIdx = Math.floor(b / 16) % 4;
        const pool = ARP_POOLS[chordIdx]!;
        const pitch = pool[ARP_STEPS[arpStep % ARP_STEPS.length]! % pool.length]!;
        const vel = b < 128 ? 55 : b >= 224 && b < 320 ? 68 : 60;
        const acc = b % 1 === 0;
        arpN.push(note(pitch, b, 0.22, hv(acc ? vel : vel - 15, 8)));
        arpStep++;
    }

    // RISER FX — rising tone before transitions
    const riserN: MidiNote[] = [];
    for (let b = 192; b < 224; b += 4) {
        riserN.push(note(50 + Math.floor((b - 192) * 0.7), b, 3.8, hv(40 + (b - 192) * 2, 5)));
    }
    for (let b = 352; b < 384; b += 4) {
        riserN.push(note(50 + Math.floor((b - 352) * 0.7), b, 3.8, hv(40 + (b - 352) * 2, 5)));
    }

    // NOISE SWEEP — filtered noise texture
    const noiseN: MidiNote[] = [];
    for (let b = 196; b < 224; b += 2) noiseN.push(note(60, b, 1.8, hv(30 + (b - 196) * 2, 5)));
    for (let b = 356; b < 384; b += 2) noiseN.push(note(60, b, 1.8, hv(30 + (b - 356) * 2, 5)));

    // ── TRACK ASSEMBLY ────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        drumFolder, drumKitTrack, percShakerTrack, percHitsTrack,
        bassFolder, subBassTrack, bassSynthTrack, pulseBassTrack,
        keysFolder, pianoTrack, rhodesTrack, organTrack,
        strPadFolder, warmPadTrack, shimmerPadTrack, darkPadTrack, stringsSoftTrack, stringsBrightTrack,
        leadsFolder, leadClassicTrack, leadSoftTrack, brassTrack, arpTrack,
        fxFolder, riserTrack, noiseSweepTrack, reverbBusTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: warmPadTrack.id });

    midiStore.set({
        notesByClipId: {
            [dk1.id]: drumN.filter(n => n.startBeat >= 64 && n.startBeat < 128).map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [dk2.id]: drumN.filter(n => n.startBeat >= 128 && n.startBeat < 224).map(n => ({ ...n, startBeat: n.startBeat - 128 })),
            [dk3.id]: drumN.filter(n => n.startBeat >= 224 && n.startBeat < 320).map(n => ({ ...n, startBeat: n.startBeat - 224 })),
            [dk4.id]: drumN.filter(n => n.startBeat >= 384 && n.startBeat < 512).map(n => ({ ...n, startBeat: n.startBeat - 384 })),
            [dk5.id]: drumN.filter(n => n.startBeat >= 512 && n.startBeat < 576).map(n => ({ ...n, startBeat: n.startBeat - 512 })),
            [subClip.id]: subN,
            [bass808Clip.id]: bass808N.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [pulseClip.id]: pulseN.map(n => ({ ...n, startBeat: n.startBeat - 32 })),
            [pianoIntro.id]: pianoN.filter(n => n.startBeat < 64),
            [pianoBD.id]: pianoN.filter(n => n.startBeat >= 320 && n.startBeat < 384).map(n => ({ ...n, startBeat: n.startBeat - 320 })),
            [pianoOutro.id]: pianoN.filter(n => n.startBeat >= 512).map(n => ({ ...n, startBeat: n.startBeat - 512 })),
            [rhodesClip.id]: rhodesN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [organClip.id]: organN.map(n => ({ ...n, startBeat: n.startBeat - 128 })),
            [warmPadClip.id]: warmPadN,
            [shimmerClip.id]: shimmerN.map(n => ({ ...n, startBeat: n.startBeat - 128 })),
            [darkClip.id]: darkN.map(n => ({ ...n, startBeat: n.startBeat - 192 })),
            [strSoftClip.id]: strSoftN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [strBrightClip.id]: strBrightN.map(n => ({ ...n, startBeat: n.startBeat - 224 })),
            [leadClip.id]: leadN.map(n => ({ ...n, startBeat: n.startBeat - 160 })),
            [leadSoftClip.id]: leadSoftN.map(n => ({ ...n, startBeat: n.startBeat - 224 })),
            [brassClip.id]: brassN.map(n => ({ ...n, startBeat: n.startBeat - 224 })),
            [arpClip.id]: arpN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [riserClip1.id]: riserN.filter(n => n.startBeat < 224).map(n => ({ ...n, startBeat: n.startBeat - 192 })),
            [riserClip2.id]: riserN.filter(n => n.startBeat >= 352).map(n => ({ ...n, startBeat: n.startBeat - 352 })),
            [noiseClip1.id]: noiseN.filter(n => n.startBeat < 224).map(n => ({ ...n, startBeat: n.startBeat - 192 })),
            [noiseClip2.id]: noiseN.filter(n => n.startBeat >= 352).map(n => ({ ...n, startBeat: n.startBeat - 352 })),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({ ...defaultTransportState, tempo: bpm, loopEnd: TB, isLooping: true });

    // ── AUTOMATION (15+ lanes) ────────────────────────────────────────────
    const mkLane = (trackId: string, param: string, label: string, min: number, max: number) =>
        createAutomationLane(trackId, param, label, min, max);

    const subVol = mkLane(subBassTrack.id, 'volume', 'Volume', 0, 1);
    subVol.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 32, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 128, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.7, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.05, curve: 'linear', tension: 0 },
    ];

    const warmVol = mkLane(warmPadTrack.id, 'volume', 'Volume', 0, 1);
    warmVol.points = [
        { beat: 0, value: 0.12, curve: 'linear', tension: 0 },
        { beat: 32, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.88, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.6, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.03, curve: 'linear', tension: 0 },
    ];

    const drumVol = mkLane(drumKitTrack.id, 'volume', 'Volume', 0, 1);
    drumVol.points = [
        { beat: 64, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 224, value: 1.0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.15, curve: 'linear', tension: 0 },
    ];

    const strSoftVol = mkLane(stringsSoftTrack.id, 'volume', 'Volume', 0, 1);
    strSoftVol.points = [
        { beat: 64, value: 0, curve: 'linear', tension: 0 },
        { beat: 96, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.35, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const arpVol = mkLane(arpTrack.id, 'volume', 'Volume', 0, 1);
    arpVol.points = [
        { beat: 64, value: 0, curve: 'linear', tension: 0 },
        { beat: 96, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 400, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 576, value: 0, curve: 'linear', tension: 0 },
    ];

    const leadVol = mkLane(leadClassicTrack.id, 'volume', 'Volume', 0, 1);
    leadVol.points = [
        { beat: 160, value: 0, curve: 'linear', tension: 0 },
        { beat: 168, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 416, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.35, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const pianoVol = mkLane(pianoTrack.id, 'volume', 'Volume', 0, 1);
    pianoVol.points = [
        { beat: 0, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 64, value: 0, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.7, curve: 'linear', tension: 0 },
        { beat: TB, value: 0, curve: 'linear', tension: 0 },
    ];

    const brassVol = mkLane(brassTrack.id, 'volume', 'Volume', 0, 1);
    brassVol.points = [
        { beat: 224, value: 0, curve: 'linear', tension: 0 },
        { beat: 232, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 310, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
    ];

    const darkVol = mkLane(darkPadTrack.id, 'volume', 'Volume', 0, 1);
    darkVol.points = [
        { beat: 192, value: 0, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 280, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 384, value: 0, curve: 'linear', tension: 0 },
    ];

    const rhodesVol = mkLane(rhodesTrack.id, 'volume', 'Volume', 0, 1);
    rhodesVol.points = [
        { beat: 64, value: 0, curve: 'linear', tension: 0 },
        { beat: 96, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.3, curve: 'linear', tension: 0 },
    ];

    const shimmerVol = mkLane(shimmerPadTrack.id, 'volume', 'Volume', 0, 1);
    shimmerVol.points = [
        { beat: 128, value: 0, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 512, value: 0, curve: 'linear', tension: 0 },
    ];

    const hatPan = mkLane(drumKitTrack.id, 'pan', 'Pan', -1, 1);
    hatPan.points = [];
    for (let b = 64; b <= TB; b += 8) {
        hatPan.points.push({ beat: b, value: (b / 8) % 2 === 0 ? 0.22 : -0.22, curve: 'linear', tension: 0 });
    }

    const pulseFilter = mkLane(pulseBassTrack.id, 'filterCutoff', 'Filter', 20, 20000);
    pulseFilter.points = [
        { beat: 32, value: 180, curve: 'linear', tension: 0 },
        { beat: 64, value: 500, curve: 'linear', tension: 0 },
        { beat: 128, value: 2400, curve: 'linear', tension: 0 },
        { beat: 224, value: 5200, curve: 'linear', tension: 0 },
        { beat: 320, value: 250, curve: 'linear', tension: 0 },
        { beat: 384, value: 1800, curve: 'linear', tension: 0 },
        { beat: 448, value: 6500, curve: 'linear', tension: 0 },
        { beat: 512, value: 2200, curve: 'linear', tension: 0 },
        { beat: TB, value: 150, curve: 'linear', tension: 0 },
    ];

    const leadSoftVol = mkLane(leadSoftTrack.id, 'volume', 'Volume', 0, 1);
    leadSoftVol.points = [
        { beat: 224, value: 0, curve: 'linear', tension: 0 },
        { beat: 240, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 512, value: 0, curve: 'linear', tension: 0 },
    ];

    const strBrightVol = mkLane(stringsBrightTrack.id, 'volume', 'Volume', 0, 1);
    strBrightVol.points = [
        { beat: 224, value: 0, curve: 'linear', tension: 0 },
        { beat: 240, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 310, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            subVol, warmVol, drumVol, strSoftVol, arpVol, leadVol,
            pianoVol, brassVol, darkVol, rhodesVol, shimmerVol,
            hatPan, pulseFilter, leadSoftVol, strBrightVol,
        ],
    });

    // ── MARKERS (12 markers, distinct from section boundaries) ────────────
    // ── SECTIONS (8 sections) ─────────────────────────────────────────────
    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
            { id: crypto.randomUUID(), beat: 16, name: 'Pad Entry', color: 'oklch(0.40 0.07 200)' },
            { id: crypto.randomUUID(), beat: 32, name: 'Sub Enters', color: 'oklch(0.38 0.08 300)' },
            { id: crypto.randomUUID(), beat: 64, name: 'Drums In', color: 'oklch(0.40 0.08 250)' },
            { id: crypto.randomUUID(), beat: 128, name: 'Full Groove', color: 'oklch(0.40 0.08 150)' },
            { id: crypto.randomUUID(), beat: 160, name: 'Lead Entry', color: 'oklch(0.38 0.09 20)' },
            { id: crypto.randomUUID(), beat: 224, name: 'DROP', color: 'oklch(0.38 0.09 0)' },
            { id: crypto.randomUUID(), beat: 288, name: 'Peak', color: 'oklch(0.38 0.08 340)' },
            { id: crypto.randomUUID(), beat: 320, name: 'Breakdown', color: 'oklch(0.40 0.08 70)' },
            { id: crypto.randomUUID(), beat: 384, name: 'Rebuild', color: 'oklch(0.40 0.08 150)' },
            { id: crypto.randomUUID(), beat: 448, name: 'Lead Returns', color: 'oklch(0.39 0.08 45)' },
            { id: crypto.randomUUID(), beat: 512, name: 'Farewell', color: 'oklch(0.38 0.08 270)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 32, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
            { id: crypto.randomUUID(), startBeat: 32, endBeat: 64, name: 'Emergence', color: 'oklch(0.38 0.08 300)' },
            { id: crypto.randomUUID(), startBeat: 64, endBeat: 128, name: 'Build', color: 'oklch(0.40 0.08 250)' },
            { id: crypto.randomUUID(), startBeat: 128, endBeat: 224, name: 'Groove', color: 'oklch(0.40 0.08 150)' },
            { id: crypto.randomUUID(), startBeat: 224, endBeat: 320, name: 'Catharsis', color: 'oklch(0.38 0.09 20)' },
            { id: crypto.randomUUID(), startBeat: 320, endBeat: 384, name: 'Breakdown', color: 'oklch(0.40 0.08 70)' },
            { id: crypto.randomUUID(), startBeat: 384, endBeat: 512, name: 'Final Rise', color: 'oklch(0.40 0.08 150)' },
            { id: crypto.randomUUID(), startBeat: 512, endBeat: TB, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
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
    const kickClip = createAudioClip(kickTrack.id, 'Synthwave Kick', 0, totalBeats, `d2-kick-${ctxId}`, kickTrack.color);
    const snareClip = createAudioClip(snareTrack.id, 'Gated Snare', 0, totalBeats, `d2-snare-${ctxId}`, snareTrack.color);
    const hatClip = createAudioClip(hatClosedTrack.id, '16th Hats', 0, totalBeats, `d2-hat-${ctxId}`, hatClosedTrack.color);
    const riserClip = createAudioClip(riserTrack.id, 'Riser', 48, 64, `d2-riser-${ctxId}`, riserTrack.color);
    riserClip.fadeInBeats = 16;

    kickTrack.clips = [kickClip];
    snareTrack.clips = [snareClip];
    hatClosedTrack.clips = [hatClip];
    riserTrack.clips = [riserClip];

    const subClip = createMidiClip(subBassTrack.id, 'Rolling Bass', 0, totalBeats, subBassTrack.color);
    const midBassClip = createMidiClip(midBassTrack.id, 'Stabs', 0, totalBeats, midBassTrack.color);
    const padClip = createMidiClip(padTrack.id, 'Chord Progression', 0, totalBeats, padTrack.color);
    const arpClip = createMidiClip(arp1Track.id, 'Arp Pattern', 16, totalBeats, arp1Track.color);
    const leadClip = createMidiClip(lead1Track.id, 'Nostalgic Melody', 32, totalBeats, lead1Track.color);

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
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: 'oklch(0.40 0.08 70)' },
            { id: crypto.randomUUID(), beat: 32, name: 'Main Theme', color: 'oklch(0.38 0.09 20)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 32, name: 'Intro', color: 'oklch(0.40 0.08 70)' },
            { id: crypto.randomUUID(), startBeat: 32, endBeat: 128, name: 'Main Theme', color: 'oklch(0.38 0.09 20)' },
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

    const kickClip = createAudioClip(kickTrack.id, 'LoFi Kick', 0, totalBeats, `d3-kick-${ctxId}`, kickTrack.color);
    const snareClip = createAudioClip(snareTrack.id, 'Rim Shot', 0, totalBeats, `d3-snare-${ctxId}`, snareTrack.color);
    const hatClip = createAudioClip(hatClosedTrack.id, 'Lazy Hats', 0, totalBeats, `d3-hat-${ctxId}`, hatClosedTrack.color);
    const vinylClip = createAudioClip(vinylNoiseTrack.id, 'Crackle Loop', 0, totalBeats, `d3-vinyl-${ctxId}`, vinylNoiseTrack.color);
    vinylClip.gain = 0.4;

    kickTrack.clips = [kickClip];
    snareTrack.clips = [snareClip];
    hatClosedTrack.clips = [hatClip];
    vinylNoiseTrack.clips = [vinylClip];

    const subClip = createMidiClip(subBassTrack.id, 'Smooth Bass', 0, totalBeats, subBassTrack.color);
    const rhodesClip = createMidiClip(rhodesTrack.id, 'Chords.tape', 0, totalBeats, rhodesTrack.color);
    const pianoClip = createMidiClip(pianoTrack.id, 'Muted Melody', 16, totalBeats, pianoTrack.color);

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
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: 'oklch(0.39 0.08 45)' },
            { id: crypto.randomUUID(), beat: 16, name: 'Vibe', color: 'oklch(0.40 0.08 150)' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 16, name: 'Intro', color: 'oklch(0.39 0.08 45)' },
            { id: crypto.randomUUID(), startBeat: 16, endBeat: 128, name: 'Vibe', color: 'oklch(0.40 0.08 150)' },
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
                style === 'snare' ? pos === 1 || pos === 3 : style === 'electro' ? pos === 1 || pos === 3 : false;

            // Hi-hat: 8th notes strictly between kick and snare positions
            // Fires at 0.5, 1.5, 2.5, 3.5 — never on 0, 1, 2, 3
            const isHat =
                (style === 'hat' || style === '4onFloor') &&
                step % 2 === 2 && // every other 8th note step (positions 0.5, 1.5, 2.5, 3.5)
                pos !== 0 &&
                pos !== 1 &&
                pos !== 2 &&
                pos !== 3;

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
