import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { projectStore } from '../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';
import { createTrack, createAutomationLane } from '#/modules/Arrangement/useCases/trackQueries';
import { arrangementStore, defaultArrangementId } from '../../stores/arrangementStore';
import type { MidiNote } from '#/modules/Arrangement/useCases/trackQueries';
import type { StretchMode } from '#/modules/Arrangement/useCases/trackQueries';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';

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

    // ── TRACKS: 36 tracks in 7 folders ────────────────────────────────────
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
    // 🌟 Flourishes folder
    const flourishFolder = createTrack({ name: '🌟 Flourishes', kind: 'folder' });
    const fluteTrack = createTrack({ name: 'Flute Counter', kind: 'midi', parentId: flourishFolder.id });
    const bellAccentTrack = createTrack({ name: 'Bell Accents', kind: 'midi', parentId: flourishFolder.id });
    const crystalTexTrack = createTrack({ name: 'Crystal Texture', kind: 'midi', parentId: flourishFolder.id });
    const tremPulseTrack = createTrack({ name: 'Tremolo Pulse', kind: 'midi', parentId: flourishFolder.id });
    const widePadTrack = createTrack({ name: 'Wide Chorus Pad', kind: 'midi', parentId: flourishFolder.id });
    const drumFillTrack = createTrack({ name: 'Drum Fills', kind: 'midi', parentId: flourishFolder.id });
    const impactFxTrack = createTrack({ name: 'Impact FX', kind: 'midi', parentId: flourishFolder.id });
    const texChirpTrack = createTrack({ name: 'Texture Chirps', kind: 'midi', parentId: flourishFolder.id });

    // ✨ Textures folder — 10 transition-fill tracks
    const textureFolder = createTrack({ name: '✨ Textures', kind: 'folder' });
    const pluckArpATrack = createTrack({ name: 'Pluck Arp A', kind: 'midi', parentId: textureFolder.id });
    const pluckArpBTrack = createTrack({ name: 'Pluck Arp B', kind: 'midi', parentId: textureFolder.id });
    const rhodesStabATrack = createTrack({ name: 'Rhodes Stab A', kind: 'midi', parentId: textureFolder.id });
    const rhodesStabBTrack = createTrack({ name: 'Rhodes Stab B', kind: 'midi', parentId: textureFolder.id });
    const bellScatterTrack = createTrack({ name: 'Bell Scatter', kind: 'midi', parentId: textureFolder.id });
    const glassSwellTrack = createTrack({ name: 'Glass Swell', kind: 'midi', parentId: textureFolder.id });
    const malletTapTrack = createTrack({ name: 'Mallet Tap', kind: 'midi', parentId: textureFolder.id });
    const pizzLayerTrack = createTrack({ name: 'Pizz Layer', kind: 'midi', parentId: textureFolder.id });
    const chimeDropTrack = createTrack({ name: 'Chime Drop', kind: 'midi', parentId: textureFolder.id });
    const microPercTrack = createTrack({ name: 'Micro Perc', kind: 'midi', parentId: textureFolder.id });

    // 🔊 FX folder
    const fxFolder = createTrack({ name: '🔊 FX & Mix', kind: 'folder' });
    const riserTrack = createTrack({ name: 'Riser', kind: 'midi', parentId: fxFolder.id });
    const noiseSweepTrack = createTrack({ name: 'Noise Sweep', kind: 'midi', parentId: fxFolder.id });
    const reverbBusTrack = createTrack({ name: 'Reverb Bus', kind: 'bus' });

    // ── PRESETS (Faust instruments for key tracks) ─────────────────────────
    // 808 Kit: type must be builtin-drum-kit for the drum engine
    drumKitTrack.devices = [{
        id: `dev-${crypto.randomUUID()}`, name: '808 Kit', type: 'builtin-drum-kit',
        bypassed: false, parameterValues: { kit: 0 },
    }];
    applyPreset(subBassTrack, 'factory-bass-sub');
    // ▸ Faust Acid Bass 303 — authentic squelchy acid bass
    applyPreset(bassSynthTrack, 'factory-faust-acid-liquid');
    applyPreset(pulseBassTrack, 'factory-bass-sub');  // sine sub — warm, not video-gamey
    applyPreset(pianoTrack, 'factory-keys-bell');      // sine bell — smooth with natural decay
    // ▸ Faust Amber Rhodes — ethereal electric piano with long reverb tail
    applyPreset(rhodesTrack, 'factory-faust-rhodes-ambient');
    // ▸ Faust Hammond Ballad — gentle organ with slow Leslie & cathedral reverb
    applyPreset(organTrack, 'factory-faust-hammond-ballad');
    applyPreset(warmPadTrack, 'factory-pad-warm');
    // ▸ Faust FM Shimmer Pad — evolving FM pad (ratio 7, slow attack)
    applyPreset(shimmerPadTrack, 'factory-faust-fm-pad');
    applyPreset(darkPadTrack, 'factory-pad-dark');
    applyPreset(stringsSoftTrack, 'factory-strings-soft');
    applyPreset(stringsBrightTrack, 'factory-strings-bright');
    // ▸ Faust Moog Portamento — smooth analog lead with glide
    applyPreset(leadClassicTrack, 'factory-faust-moog-portamento');
    applyPreset(leadSoftTrack, 'factory-lead-soft');
    applyPreset(brassTrack, 'factory-synth-brass');
    applyPreset(arpTrack, 'factory-synth-arp');
    applyPreset(riserTrack, 'factory-fx-riser');
    applyPreset(noiseSweepTrack, 'factory-fx-noise-sweep');
    applyPreset(fluteTrack, 'factory-synth-flute');
    // ▸ Faust DX Bells — crystalline FM bell tones
    applyPreset(bellAccentTrack, 'factory-faust-fm-dx-bells');
    applyPreset(crystalTexTrack, 'factory-keys-marimba');  // sine percussive — organic, not sustained
    applyPreset(tremPulseTrack, 'factory-keys-pluck');     // triangle pluck — natural decay
    // ▸ Faust Supersaw Pad — massive detuned pad with reverb
    applyPreset(widePadTrack, 'factory-faust-supersaw-pad');
    // Drum Fills: same 808 kit for fills
    drumFillTrack.devices = [{
        id: `dev-${crypto.randomUUID()}`, name: '808 Kit', type: 'builtin-drum-kit',
        bypassed: false, parameterValues: { kit: 0 },
    }];
    // Impact FX: sub bass preset for sub drops
    applyPreset(impactFxTrack, 'factory-bass-sub');
    // ▸ Faust Additive Glass — delicate chirp textures
    applyPreset(texChirpTrack, 'factory-faust-additive-glass');
    // ── TEXTURE TRACK PRESETS ──────────────────────────────────────────────
    applyPreset(pluckArpATrack, 'factory-keys-pluck');
    applyPreset(pluckArpBTrack, 'factory-keys-pluck');
    applyPreset(rhodesStabATrack, 'factory-faust-rhodes-ambient');
    applyPreset(rhodesStabBTrack, 'factory-faust-rhodes-ambient');
    applyPreset(bellScatterTrack, 'factory-faust-fm-dx-bells');
    applyPreset(glassSwellTrack, 'factory-faust-additive-glass');
    applyPreset(malletTapTrack, 'factory-keys-marimba');
    applyPreset(pizzLayerTrack, 'factory-keys-pluck');
    applyPreset(chimeDropTrack, 'factory-faust-fm-dx-bells');
    applyPreset(microPercTrack, 'factory-keys-marimba');
    // ── EFFECTS on tracks (web-compatible only) ──────────────────────────
    const addDev = (t: any, type: string, name: string, params: Record<string, number>) => {
        t.devices = [...(t.devices || []), {
            id: `dev-${crypto.randomUUID()}`, name, type, bypassed: false,
            parameterValues: params,
        }];
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  MASTER CHAIN — Kiasmos/Jon Hopkins style mastering        ║
    // ╚═══════════════════════════════════════════════════════════════╝
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 1.5, 'eq-low-freq': 80, 'eq-low-q': 0.8,
        'eq-mid-gain': -1, 'eq-mid-freq': 400, 'eq-mid-q': 1.2,
        'eq-high-gain': 2, 'eq-high-freq': 10000, 'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -12, 'comp-ratio': 2.5, 'comp-attack': 30,
        'comp-release': 200, 'comp-knee': 10, 'comp-makeup': 2,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.15, 'width-mid': 0, 'width-side': 1.5, 'width-mono-bass': 180,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -1 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -14 });

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  MIX BUS PROCESSING — depth, width, glue                  ║
    // ╚═══════════════════════════════════════════════════════════════╝
    // Drums: EQ scoop + gentle compression for punch
    addDev(drumKitTrack, 'builtin-eq', 'Drum EQ', {
        'eq-low-gain': 3, 'eq-low-freq': 60, 'eq-low-q': 1,
        'eq-mid-gain': -2, 'eq-mid-freq': 350, 'eq-mid-q': 1.5,
        'eq-high-gain': 1, 'eq-high-freq': 8000, 'eq-high-q': 0.8,
    });
    addDev(drumKitTrack, 'builtin-compressor', 'Drum Glue', {
        'comp-threshold': -12, 'comp-ratio': 2, 'comp-attack': 15,
        'comp-release': 100, 'comp-knee': 10, 'comp-makeup': 1,
    });
    // Sub bass: compressor for tight low end
    addDev(subBassTrack, 'builtin-compressor', 'Sub Comp', {
        'comp-threshold': -15, 'comp-ratio': 4, 'comp-attack': 5,
        'comp-release': 100, 'comp-knee': 6, 'comp-makeup': 2,
    });
    // Reverb bus: convolution reverb (Studio A) for shared depth
    addDev(reverbBusTrack, 'builtin-convolution-reverb', 'Room IR', {
        'conv-ir': 6, 'conv-mix': 0.5, 'conv-predelay': 25,
        'conv-lowcut': 80, 'conv-highcut': 10000,
    });
    // Warm Pad: EQ for warmth and air (boost low-mids + gentle high shelf)
    addDev(warmPadTrack, 'builtin-eq', 'Pad Warmth', {
        'eq-low-gain': 2, 'eq-low-freq': 200, 'eq-low-q': 0.8,
        'eq-mid-gain': -1.5, 'eq-mid-freq': 800, 'eq-mid-q': 1.2,
        'eq-high-gain': 1.5, 'eq-high-freq': 8000, 'eq-high-q': 0.6,
    });

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  PER-TRACK EFFECTS — character, space, movement            ║
    // ╚═══════════════════════════════════════════════════════════════╝
    // Lead (Moog): dotted delay + chorus + filtered reverb
    addDev(leadClassicTrack, 'builtin-delay', 'Dotted Delay', { 'delay-time': 375, 'delay-feedback': 0.3, 'delay-mix': 0.2 });
    addDev(leadClassicTrack, 'builtin-chorus', 'Lead Chorus', { 'chorus-rate': 0.6, 'chorus-depth': 5, 'chorus-feedback': 0.15, 'chorus-mix': 0.25 });
    addDev(leadClassicTrack, 'builtin-reverb', 'Lead Space', { 'rev-size': 0.6, 'rev-decay': 3, 'rev-damping': 0.3, 'rev-mix': 0.25 });
    // Lead Soft: phaser + reverb for dreamy Jon Hopkins quality (lower wet to avoid mud)
    addDev(leadSoftTrack, 'builtin-phaser', 'Dream Phase', { 'phaser-rate': 0.15, 'phaser-depth': 0.8, 'phaser-feedback': 0.55, 'phaser-stages': 6 });
    addDev(leadSoftTrack, 'builtin-reverb', 'Soft Hall', { 'rev-size': 0.8, 'rev-decay': 4, 'rev-damping': 0.2, 'rev-mix': 0.22 });
    // Brass: reverb + EQ brightening for grandeur
    addDev(brassTrack, 'builtin-reverb', 'Brass Hall', { 'rev-size': 0.65, 'rev-decay': 2.5, 'rev-damping': 0.3, 'rev-mix': 0.25 });
    // Rhodes (Faust Ambient): chorus + delay for warmth and movement
    addDev(rhodesTrack, 'builtin-chorus', 'Rhodes Shimmer', { 'chorus-rate': 0.35, 'chorus-depth': 4, 'chorus-feedback': 0.12, 'chorus-mix': 0.25 });
    addDev(rhodesTrack, 'builtin-delay', 'Rhodes Echo', { 'delay-time': 375, 'delay-feedback': 0.25, 'delay-mix': 0.18 });
    // Piano: convolution reverb for natural room
    addDev(pianoTrack, 'builtin-convolution-reverb', 'Piano Room', {
        'conv-ir': 0, 'conv-mix': 0.25, 'conv-predelay': 10,
        'conv-lowcut': 100, 'conv-highcut': 12000,
    });
    // Arp: phaser + ping-pong delay for spatial movement
    addDev(arpTrack, 'builtin-phaser', 'Arp Phase', { 'phaser-rate': 0.3, 'phaser-depth': 0.5, 'phaser-feedback': 0.35, 'phaser-stages': 4 });
    addDev(arpTrack, 'builtin-delay', 'Arp Delay', { 'delay-time': 188, 'delay-feedback': 0.4, 'delay-mix': 0.25 });
    addDev(arpTrack, 'builtin-autopan', 'Arp Pan', { 'autopan-rate': 0.5, 'autopan-depth': 0.6 });
    // Shimmer Pad (Faust FM): chorus for extra shimmer
    addDev(shimmerPadTrack, 'builtin-chorus', 'Shimmer Chorus', { 'chorus-rate': 0.15, 'chorus-depth': 10, 'chorus-feedback': 0.2, 'chorus-mix': 0.35 });
    // Warm Pad: slow flanger for evolving texture (Kiasmos trick) + reverb
    addDev(warmPadTrack, 'builtin-flanger', 'Pad Flange', { 'flanger-rate': 0.06, 'flanger-depth': 5, 'flanger-feedback': 0.35, 'flanger-mix': 0.2 });
    addDev(warmPadTrack, 'builtin-reverb', 'Pad Reverb', { 'rev-size': 0.9, 'rev-decay': 5, 'rev-damping': 0.15, 'rev-mix': 0.2 });
    // Dark Pad: phaser + distortion for sinister texture (Jon Hopkins "Immunity" style)
    addDev(darkPadTrack, 'builtin-phaser', 'Dark Phase', { 'phaser-rate': 0.08, 'phaser-depth': 0.9, 'phaser-feedback': 0.65, 'phaser-stages': 6 });
    addDev(darkPadTrack, 'builtin-distortion', 'Dark Saturation', { 'dist-drive': 2, 'dist-tone': 2000, 'dist-mix': 0.1, 'dist-output': -3 });
    // Strings Soft: lush reverb
    addDev(stringsSoftTrack, 'builtin-reverb', 'Strings Hall', { 'rev-size': 0.85, 'rev-decay': 4, 'rev-damping': 0.2, 'rev-mix': 0.3 });
    // Strings Bright: reverb + chorus + EQ presence
    addDev(stringsBrightTrack, 'builtin-reverb', 'Bright Hall', { 'rev-size': 0.7, 'rev-decay': 2.5, 'rev-damping': 0.2, 'rev-mix': 0.25 });
    addDev(stringsBrightTrack, 'builtin-chorus', 'Bright Chorus', { 'chorus-rate': 0.3, 'chorus-depth': 6, 'chorus-mix': 0.2 });
    // Pulse Bass: chorus + delay + subtle bitcrusher for grit
    addDev(pulseBassTrack, 'builtin-chorus', 'Pulse Width', { 'chorus-rate': 0.5, 'chorus-depth': 3, 'chorus-feedback': 0.1, 'chorus-mix': 0.15 });
    addDev(pulseBassTrack, 'builtin-delay', 'Pulse Echo', { 'delay-time': 188, 'delay-feedback': 0.25, 'delay-mix': 0.15 });
    addDev(pulseBassTrack, 'builtin-bitcrusher', 'Lofi Grit', { 'crush-bits': 12, 'crush-rate': 2, 'crush-mix': 0.08 });
    // Organ (Faust Hammond): already has Leslie, add tremolo override
    addDev(organTrack, 'builtin-tremolo', 'Leslie Trem', { 'trem-rate': 5.5, 'trem-depth': 0.3, 'trem-shape': 0 });
    // Flute: delay + reverb for floating quality
    addDev(fluteTrack, 'builtin-delay', 'Flute Echo', { 'delay-time': 330, 'delay-feedback': 0.35, 'delay-mix': 0.22 });
    addDev(fluteTrack, 'builtin-reverb', 'Flute Space', { 'rev-size': 0.7, 'rev-decay': 3, 'rev-damping': 0.3, 'rev-mix': 0.3 });
    // Bell Accents (Faust DX Bells): already has reverb from preset, add shimmer delay
    addDev(bellAccentTrack, 'builtin-delay', 'Bell Echo', { 'delay-time': 500, 'delay-feedback': 0.35, 'delay-mix': 0.25 });
    // Crystal Texture: delay + reverb (tamed wet) + auto-pan for scattered texture
    addDev(crystalTexTrack, 'builtin-delay', 'Crystal Delay', { 'delay-time': 200, 'delay-feedback': 0.5, 'delay-mix': 0.3 });
    addDev(crystalTexTrack, 'builtin-reverb', 'Crystal Wash', { 'rev-size': 0.95, 'rev-decay': 5, 'rev-damping': 0.15, 'rev-mix': 0.22 });
    addDev(crystalTexTrack, 'builtin-autopan', 'Crystal Pan', { 'autopan-rate': 0.3, 'autopan-depth': 0.5 });
    // Tremolo Pulse: tremolo + phaser
    addDev(tremPulseTrack, 'builtin-tremolo', 'Pulse Trem', { 'trem-rate': 3, 'trem-depth': 0.6, 'trem-shape': 0 });
    addDev(tremPulseTrack, 'builtin-phaser', 'Pulse Phase', { 'phaser-rate': 0.2, 'phaser-depth': 0.6, 'phaser-feedback': 0.4, 'phaser-stages': 4 });
    // Wide Pad (Faust Supersaw): already has reverb, add deep chorus
    addDev(widePadTrack, 'builtin-chorus', 'Wide Chorus', { 'chorus-rate': 0.15, 'chorus-depth': 14, 'chorus-feedback': 0.3, 'chorus-mix': 0.5 });
    // Drum Fills: reverb on fills for space
    addDev(drumFillTrack, 'builtin-reverb', 'Fill Verb', { 'rev-size': 0.4, 'rev-decay': 1.2, 'rev-damping': 0.5, 'rev-mix': 0.2 });
    // Impact FX: reverb (tamed) + distortion for impact weight
    addDev(impactFxTrack, 'builtin-reverb', 'Impact Tail', { 'rev-size': 0.95, 'rev-decay': 5, 'rev-damping': 0.1, 'rev-mix': 0.3 });
    addDev(impactFxTrack, 'builtin-distortion', 'Impact Drive', { 'dist-drive': 4, 'dist-tone': 1500, 'dist-mix': 0.12 });
    // Texture Chirps (Faust Additive Glass): delay + autopan for scattered glass
    addDev(texChirpTrack, 'builtin-delay', 'Chirp Delay', { 'delay-time': 166, 'delay-feedback': 0.5, 'delay-mix': 0.35 });
    addDev(texChirpTrack, 'builtin-autopan', 'Chirp Pan', { 'autopan-rate': 2, 'autopan-depth': 0.8 });
    // Noise Sweep: bitcrusher for lo-fi texture
    addDev(noiseSweepTrack, 'builtin-bitcrusher', 'Noise Crush', { 'crush-bits': 6, 'crush-rate': 8, 'crush-mix': 0.15 });
    // Riser: filter + reverb for sweeping builds
    addDev(riserTrack, 'builtin-filter', 'Rise Filter', { 'filter-cutoff': 500, 'filter-resonance': 4, 'filter-type': 0 });
    addDev(riserTrack, 'builtin-reverb', 'Rise Space', { 'rev-size': 0.8, 'rev-decay': 3, 'rev-damping': 0.3, 'rev-mix': 0.3 });
    // ── TEXTURE TRACK EFFECTS ─────────────────────────────────────────────
    addDev(pluckArpATrack, 'builtin-delay', 'Pluck Delay', { 'delay-time': 250, 'delay-feedback': 0.4, 'delay-mix': 0.3 });
    addDev(pluckArpATrack, 'builtin-reverb', 'Pluck Space', { 'rev-size': 0.6, 'rev-decay': 2, 'rev-damping': 0.3, 'rev-mix': 0.2 });
    addDev(pluckArpBTrack, 'builtin-delay', 'Pluck Echo', { 'delay-time': 375, 'delay-feedback': 0.45, 'delay-mix': 0.35 });
    addDev(pluckArpBTrack, 'builtin-chorus', 'Pluck Chorus', { 'chorus-rate': 0.3, 'chorus-depth': 5, 'chorus-mix': 0.2 });
    addDev(rhodesStabATrack, 'builtin-chorus', 'Stab Chorus', { 'chorus-rate': 0.8, 'chorus-depth': 6, 'chorus-mix': 0.3 });
    addDev(rhodesStabATrack, 'builtin-reverb', 'Stab Verb', { 'rev-size': 0.7, 'rev-decay': 2.5, 'rev-damping': 0.25, 'rev-mix': 0.25 });
    addDev(rhodesStabBTrack, 'builtin-delay', 'Stab Echo', { 'delay-time': 333, 'delay-feedback': 0.35, 'delay-mix': 0.3 });
    addDev(rhodesStabBTrack, 'builtin-chorus', 'Ghost Chorus', { 'chorus-rate': 1.2, 'chorus-depth': 8, 'chorus-mix': 0.4 });
    addDev(bellScatterTrack, 'builtin-delay', 'Bell Scatter', { 'delay-time': 166, 'delay-feedback': 0.55, 'delay-mix': 0.4 });
    addDev(bellScatterTrack, 'builtin-reverb', 'Bell Wash', { 'rev-size': 0.9, 'rev-decay': 4, 'rev-damping': 0.2, 'rev-mix': 0.3 });
    addDev(glassSwellTrack, 'builtin-reverb', 'Glass Verb', { 'rev-size': 0.95, 'rev-decay': 6, 'rev-damping': 0.1, 'rev-mix': 0.4 });
    addDev(glassSwellTrack, 'builtin-chorus', 'Glass Shimmer', { 'chorus-rate': 0.2, 'chorus-depth': 12, 'chorus-mix': 0.35 });
    addDev(malletTapTrack, 'builtin-delay', 'Mallet Echo', { 'delay-time': 125, 'delay-feedback': 0.3, 'delay-mix': 0.25 });
    addDev(pizzLayerTrack, 'builtin-reverb', 'Pizz Space', { 'rev-size': 0.5, 'rev-decay': 1.5, 'rev-damping': 0.4, 'rev-mix': 0.2 });
    addDev(chimeDropTrack, 'builtin-delay', 'Chime Trail', { 'delay-time': 500, 'delay-feedback': 0.5, 'delay-mix': 0.4 });
    addDev(chimeDropTrack, 'builtin-reverb', 'Chime Space', { 'rev-size': 0.95, 'rev-decay': 5, 'rev-damping': 0.15, 'rev-mix': 0.35 });
    addDev(microPercTrack, 'builtin-delay', 'Micro Echo', { 'delay-time': 83, 'delay-feedback': 0.4, 'delay-mix': 0.3 });
    addDev(microPercTrack, 'builtin-phaser', 'Micro Phase', { 'phaser-rate': 0.4, 'phaser-depth': 0.7, 'phaser-feedback': 0.5, 'phaser-stages': 4 });

    // ── GAIN / PAN — stereo field (rebalanced for ambient clarity) ─────
    drumKitTrack.gain = 0.55; drumKitTrack.pan = 0;
    percShakerTrack.gain = 0.22; percShakerTrack.pan = 35;
    percHitsTrack.gain = 0.28; percHitsTrack.pan = -25;
    subBassTrack.gain = 0.80; subBassTrack.pan = 0;
    bassSynthTrack.gain = 0.55; bassSynthTrack.pan = 5;
    pulseBassTrack.gain = 0.48; pulseBassTrack.pan = 8;
    pianoTrack.gain = 0.62; pianoTrack.pan = -22;
    rhodesTrack.gain = 0.50; rhodesTrack.pan = 18;
    organTrack.gain = 0.35; organTrack.pan = -8;
    warmPadTrack.gain = 0.65; warmPadTrack.pan = 12;
    shimmerPadTrack.gain = 0.19; shimmerPadTrack.pan = -30;
    darkPadTrack.gain = 0.42; darkPadTrack.pan = 20;
    stringsSoftTrack.gain = 0.42; stringsSoftTrack.pan = -15;
    stringsBrightTrack.gain = 0.42; stringsBrightTrack.pan = 25;
    leadClassicTrack.gain = 0.60; leadClassicTrack.pan = -8;
    leadSoftTrack.gain = 0.45; leadSoftTrack.pan = 15;
    brassTrack.gain = 0.40; brassTrack.pan = 5;
    arpTrack.gain = 0.35; arpTrack.pan = 32;
    riserTrack.gain = 0.38; riserTrack.pan = 0;
    noiseSweepTrack.gain = 0.30; noiseSweepTrack.pan = 0;
    fluteTrack.gain = 0.38; fluteTrack.pan = -28;
    bellAccentTrack.gain = 0.005; bellAccentTrack.pan = 22;
    crystalTexTrack.gain = 0.18; crystalTexTrack.pan = -35;
    tremPulseTrack.gain = 0.28; tremPulseTrack.pan = 30;
    widePadTrack.gain = 0.42; widePadTrack.pan = 0;
    drumFillTrack.gain = 0.40; drumFillTrack.pan = 0;
    impactFxTrack.gain = 0.45; impactFxTrack.pan = 0;
    texChirpTrack.gain = 0.15; texChirpTrack.pan = -40;
    // Texture tracks — very low gain, wide stereo field
    pluckArpATrack.gain = 0.06; pluckArpATrack.pan = -30;
    pluckArpBTrack.gain = 0.05; pluckArpBTrack.pan = 35;
    rhodesStabATrack.gain = 0.05; rhodesStabATrack.pan = -25;
    rhodesStabBTrack.gain = 0.04; rhodesStabBTrack.pan = 28;
    bellScatterTrack.gain = 0.03; bellScatterTrack.pan = 38;
    glassSwellTrack.gain = 0.07; glassSwellTrack.pan = -18;
    malletTapTrack.gain = 0.05; malletTapTrack.pan = 20;
    pizzLayerTrack.gain = 0.06; pizzLayerTrack.pan = -35;
    chimeDropTrack.gain = 0.04; chimeDropTrack.pan = 0;
    microPercTrack.gain = 0.08; microPercTrack.pan = -40;

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
    // Perc shaker: ONLY in last section for dramatic texture build
    const shakerLast = createAudioClip(percShakerTrack.id, 'Shaker Last', 448, 576, bShaker, percShakerTrack.color);
    percShakerTrack.clips = [shakerLast];

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

    // Flourish clips
    const fluteClip = createMidiClip(fluteTrack.id, 'Flute Counter', 128, 512, fluteTrack.color);
    fluteTrack.clips = [fluteClip];
    const bellAccClip = createMidiClip(bellAccentTrack.id, 'Bell Accents', 64, TB, bellAccentTrack.color);
    bellAccentTrack.clips = [bellAccClip];
    const crystalClip = createMidiClip(crystalTexTrack.id, 'Crystal Seq', 192, 512, crystalTexTrack.color);
    crystalTexTrack.clips = [crystalClip];
    const tremPulseClip = createMidiClip(tremPulseTrack.id, 'Trem Pulse', 128, 384, tremPulseTrack.color);
    tremPulseTrack.clips = [tremPulseClip];
    const widePadClip = createMidiClip(widePadTrack.id, 'Wide Pad', 64, TB, widePadTrack.color);
    widePadTrack.clips = [widePadClip];
    const drumFillClip = createMidiClip(drumFillTrack.id, 'Drum Fills', 64, 576, drumFillTrack.color);
    drumFillTrack.clips = [drumFillClip];
    const impactClip = createMidiClip(impactFxTrack.id, 'Impacts', 64, 512, impactFxTrack.color);
    impactFxTrack.clips = [impactClip];
    const chirpClip = createMidiClip(texChirpTrack.id, 'Chirps', 128, 512, texChirpTrack.color);
    texChirpTrack.clips = [chirpClip];
    // ── TEXTURE TRACK CLIPS ──────────────────────────────────────────────
    const pluckArpAClip = createMidiClip(pluckArpATrack.id, 'Pluck Arp A', 32, TB, pluckArpATrack.color);
    pluckArpATrack.clips = [pluckArpAClip];
    const pluckArpBClip = createMidiClip(pluckArpBTrack.id, 'Pluck Arp B', 32, TB, pluckArpBTrack.color);
    pluckArpBTrack.clips = [pluckArpBClip];
    const rhodesStabAClip = createMidiClip(rhodesStabATrack.id, 'Rhodes A', 64, TB, rhodesStabATrack.color);
    rhodesStabATrack.clips = [rhodesStabAClip];
    const rhodesStabBClip = createMidiClip(rhodesStabBTrack.id, 'Rhodes B', 64, TB, rhodesStabBTrack.color);
    rhodesStabBTrack.clips = [rhodesStabBClip];
    const bellScatterClip = createMidiClip(bellScatterTrack.id, 'Bells', 64, TB, bellScatterTrack.color);
    bellScatterTrack.clips = [bellScatterClip];
    const glassSwellClip = createMidiClip(glassSwellTrack.id, 'Glass', 64, TB, glassSwellTrack.color);
    glassSwellTrack.clips = [glassSwellClip];
    const malletTapClip = createMidiClip(malletTapTrack.id, 'Mallets', 64, 576, malletTapTrack.color);
    malletTapTrack.clips = [malletTapClip];
    const pizzLayerClip = createMidiClip(pizzLayerTrack.id, 'Pizz', 128, 512, pizzLayerTrack.color);
    pizzLayerTrack.clips = [pizzLayerClip];
    const chimeDropClip = createMidiClip(chimeDropTrack.id, 'Chimes', 32, TB, chimeDropTrack.color);
    chimeDropTrack.clips = [chimeDropClip];
    const microPercClip = createMidiClip(microPercTrack.id, 'Micro', 64, 576, microPercTrack.color);
    microPercTrack.clips = [microPercClip];

    // 808 DRUM KIT NOTES — AMBIENT/MINIMAL style (Kiasmos inspired)
    // Sparse kicks in intro, hi-hat variety, 4-on-floor in final section
    const drumN: MidiNote[] = [];
    for (let b = 64; b < 576; b += 1) {
        if (b >= 320 && b < 384) continue; // breakdown silence
        const pos = b % 4;
        const bar = Math.floor(b / 4);
        const inBuild = b < 128;
        const inCatharsis = b >= 224 && b < 320;
        const inFinal = b >= 384 && b < 512;  // dance section
        const inOutro = b >= 512;

        // === KICK ===
        if (inFinal) {
            // 4-on-the-floor dance pattern
            if (pos === 0) {
                drumN.push(note(36, b, 0.8, hv(90, 6)));
            }
        } else if (inBuild && pos === 0 && bar % 2 === 0) {
            drumN.push(note(36, b, 1.0, hv(65, 8)));
        } else if (inOutro && pos === 0 && bar % 2 === 0) {
            drumN.push(note(36, b, 1.0, hv(55, 8)));
        } else if (!inBuild && !inOutro) {
            if (pos === 0) {
                drumN.push(note(36, b, 1.0, hv(inCatharsis ? 95 : 80, 6)));
            }
            if (pos === 2 && bar % 2 === 0) {
                drumN.push(note(36, b, 0.8, hv(inCatharsis ? 65 : 50, 8)));
            }
        }

        // === SNARE/RIMSHOT ===
        if (inFinal && pos === 2) {
            // Snare on 3 for dance sections
            drumN.push(note(38, b, 0.3, hv(78, 8)));
        } else if (!inBuild && pos === 3 && bar % 2 === 1) {
            const snarePitch = inCatharsis ? 38 : 37;
            drumN.push(note(snarePitch, b, 0.3, hv(inCatharsis ? 72 : 55, 10)));
        }

        // === HI-HATS (varied patterns, between kick and snare, never overlapping) ===
        if (inBuild) {
            // Intro: varied closed hats on offbeats with occasional open hat
            if (pos === 1) {
                drumN.push(note(42, b, 0.15, hv(35, 12))); // closed hat
            }
            if (pos === 3 && bar % 2 === 0) {
                drumN.push(note(42, b, 0.1, hv(28, 12))); // ghost hat
            }
            if (pos === 1 && bar % 4 === 3) {
                drumN.push(note(46, b + 0.5, 0.3, hv(38, 10))); // open hat accent
            }
        } else if (inFinal) {
            // Offbeat hats for dance feel
            if (pos === 1 || pos === 3) {
                drumN.push(note(42, b, 0.15, hv(42, 10)));
            }
            if (bar % 4 === 3 && pos === 3) {
                drumN.push(note(46, b + 0.5, 0.3, hv(45, 8))); // open hat fill
            }
        } else if (!inOutro) {
            // Regular sections: offbeat closed hat
            if (pos === 0) {
                drumN.push(note(42, b + 0.5, 0.2, hv(40, 12)));
            }
            if (bar % 4 === 3 && pos === 2) {
                drumN.push(note(46, b, 0.5, hv(45, 8))); // open hat every 4 bars
            }
        }
    }

    // SUB BASS — deep root drone every 4 beats (long droning notes)
    const subN: MidiNote[] = [];
    for (let b = 0; b < TB; b += 4) {
        const c = ch(b);
        const inBD = b >= 320 && b < 384;
        const vel = b < 16 ? 35 : b < 32 ? 45 : b < 64 ? 58 : inBD ? 38 : b >= 512 ? 48 : 72;
        subN.push(note(c.sub, b, 3.8, hv(vel, 5)));
    }

    // 808 BASS — melodic line with varied rhythmic patterns per section
    const bass808N: MidiNote[] = [];
    for (let b = 64; b < TB; b += 4) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b >= 224 && b < 320 ? 95 : b >= 512 ? 60 : 78;
        const phrase = Math.floor(b / 16) % 4;

        // DOUBLE-TIME in dance section (384-512): 8th note patterns
        if (b >= 384 && b < 512) {
            bass808N.push(note(c.root, b, 0.4, hv(vel, 6)));
            bass808N.push(note(c.root, b + 0.5, 0.3, hv(vel - 15, 8)));
            bass808N.push(note(c.fifth, b + 1, 0.4, hv(vel - 8, 6)));
            bass808N.push(note(c.root, b + 1.5, 0.3, hv(vel - 12, 8)));
            bass808N.push(note(c.root, b + 2, 0.4, hv(vel - 3, 6)));
            bass808N.push(note(c.third, b + 2.5, 0.3, hv(vel - 15, 8)));
            bass808N.push(note(c.fifth, b + 3, 0.4, hv(vel - 6, 6)));
            bass808N.push(note(c.root, b + 3.5, 0.3, hv(vel - 18, 8)));
        } else if (phrase === 0) {
            bass808N.push(note(c.root, b, 1.2, hv(vel, 6)));
            bass808N.push(note(c.fifth, b + 2, 0.8, hv(vel - 10, 8)));
            bass808N.push(note(c.root, b + 3, 0.8, hv(vel - 5, 6)));
        } else if (phrase === 1) {
            bass808N.push(note(c.root, b, 0.6, hv(vel, 6)));
            bass808N.push(note(c.third, b + 1, 0.6, hv(vel - 8, 8)));
            bass808N.push(note(c.fifth, b + 2.5, 1.2, hv(vel - 5, 6)));
        } else if (phrase === 2) {
            bass808N.push(note(c.root, b, 2.0, hv(vel, 6)));  // held note
            bass808N.push(note(c.root + 12, b + 2.5, 0.4, hv(vel - 12, 10))); // octave accent
            bass808N.push(note(c.fifth, b + 3, 0.8, hv(vel - 8, 8)));
        } else {
            bass808N.push(note(c.root, b, 0.8, hv(vel, 6)));
            bass808N.push(note(c.fifth, b + 1.5, 0.4, hv(vel - 10, 8)));
            bass808N.push(note(c.third, b + 2, 1.5, hv(vel - 6, 6))); // longer third
        }
    }

    // PULSE BASS — syncopated 8th-note pattern (+12 octave to separate from sub)
    const pulseN: MidiNote[] = [];
    const pulseOffsets = [0, 0.5, 1.5, 2, 3, 3.5];
    const pulseDenseOffsets = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]; // 16ths
    for (let bar = 8; bar < TB / 4; bar++) {
        const b = bar * 4;
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b < 64 ? 0.7 : b >= 512 ? 0.75 : 1.0;

        // Dense 16th-note pattern in dance section
        if (b >= 384 && b < 512) {
            for (const off of pulseDenseOffsets) {
                const bt = b + off;
                const isDown = off % 1 === 0;
                const pitch = (off % 2 < 1 ? c.root : c.fifth) + 12;
                pulseN.push(note(pitch, bt, 0.2, hv(Math.round((isDown ? 78 : 55) * vel), 10)));
            }
        } else {
            for (const off of pulseOffsets) {
                const bt = b + off;
                const isAcc = off === 0 || off === 2;
                const pitch = (off === 0.5 || off === 1.5 ? c.fifth : c.root) + 12; // +12 octave up
                pulseN.push(note(pitch, bt, 0.4, hv(Math.round((isAcc ? 88 : 65) * vel), 10)));
            }
        }
    }

    // PIANO (bell preset) — clean sine bell tones, let natural decay do the work
    const pianoN: MidiNote[] = [];
    // Intro: sparse single notes, each rings out naturally
    for (let b = 2; b < 64; b += 8) {
        const c = ch(b);
        const vel = b < 16 ? 40 : 50;
        pianoN.push(note(c.root + 24, b, 1.5, hv(vel, 8)));
        pianoN.push(note(c.fifth + 24, b + 2, 1.5, hv(vel - 8, 10)));
        pianoN.push(note(c.third + 24, b + 4, 2.0, hv(vel - 4, 8)));
        pianoN.push(note(c.seventh + 24, b + 6, 1.5, hv(vel - 12, 10)));
    }
    // Breakdown: soft chords with gentle velocity crescendo
    for (let b = 320; b < 384; b += 8) {
        const c = ch(b);
        const vel = 55 + Math.floor((b - 320) * 0.15);
        pianoN.push(note(c.root + 24, b, 2.0, hv(vel, 8)));
        pianoN.push(note(c.fifth + 24, b + 2, 1.5, hv(vel - 6, 8)));
        pianoN.push(note(c.third + 24, b + 4, 2.0, hv(vel - 4, 10)));
        pianoN.push(note(c.seventh + 24, b + 6, 1.5, hv(vel - 10, 10)));
    }
    // Outro: sustained bell tones dissolving
    for (let b = 512; b < TB; b += 16) {
        const c = ch(b);
        const fadeVel = Math.max(25, 50 - Math.floor((b - 512) * 0.3));
        pianoN.push(note(c.root + 24, b, 4, hv(fadeVel, 6)));
        pianoN.push(note(c.fifth + 24, b + 4, 4, hv(fadeVel - 6, 8)));
        pianoN.push(note(c.third + 24, b + 8, 4, hv(fadeVel - 10, 8)));
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

    // SHIMMER PAD — ethereal in intense sections (-12 octave to sit below leads)
    const shimmerN: MidiNote[] = [];
    for (let b = 128; b < 512; b += 16) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b >= 224 && b < 320 ? 58 : 45;
        shimmerN.push(note(c.ninth + 12, b, 15.8, hv(vel, 10)));  // -12 from +24
        shimmerN.push(note(c.root + 24, b, 15.8, hv(vel - 15, 10)));  // -12 from +36
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

    // ARP — chord-tone 8th-note sequence (not 16ths — ambient not DnB)
    const ARP_POOLS: number[][] = [
        [62, 65, 69, 72, 74], [67, 70, 74, 77],
        [69, 72, 76, 79], [70, 74, 77, 81],
    ];
    const ARP_STEPS = [0, 2, 1, 3, 2, 4, 3, 1];
    const arpN: MidiNote[] = [];
    let arpStep = 0;
    for (let b = 64; b < TB; b += 0.5) { // 8th notes, not 16ths
        if (b >= 320 && b < 384) continue;
        if (b >= 576) continue;
        const chordIdx = Math.floor(b / 16) % 4;
        const pool = ARP_POOLS[chordIdx]!;
        const pitch = pool[ARP_STEPS[arpStep % ARP_STEPS.length]! % pool.length]!;
        const vel = b < 128 ? 42 : b >= 224 && b < 320 ? 55 : 48;
        const acc = b % 2 === 0; // accent on beats
        arpN.push(note(pitch, b, 0.4, hv(acc ? vel : vel - 12, 8)));
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

    // FLUTE COUNTER — lyrical Dm phrases that answer the lead
    const fluteN: MidiNote[] = [];
    const fluteA: [number, number, number, number][] = [
        [0, 74, 1.5, 62], [2, 72, 1, 58], [3, 69, 0.75, 60],
        [4, 67, 2, 55], [6, 69, 1, 52], [7, 72, 1, 58],
    ];
    const fluteB: [number, number, number, number][] = [
        [0, 77, 2, 60], [2.5, 74, 0.5, 55], [3, 72, 1.5, 58],
        [5, 69, 1, 55], [6.5, 67, 1.5, 50],
    ];
    for (let ph = 0; ph < (512 - 128) / 8; ph++) {
        const start = 128 + ph * 8;
        if (start >= 320 && start < 384) continue;
        const mel = ph % 2 === 0 ? fluteA : fluteB;
        for (const [off, pitch, dur, vel] of mel) fluteN.push(note(pitch, start + off, dur, hv(vel)));
    }

    // BELL ACCENTS — sparse bell tones on chord changes (-12 octave to sit in mid range)
    const bellAccN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 16) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const inOutro = b >= 512;
        bellAccN.push(note(c.ninth + 24, b + 2, 3, hv(inOutro ? 30 : 42)));  // -12 from +36
        if (b % 32 === 0 && b >= 128) bellAccN.push(note(c.root + 36, b + 8, 4, hv(35)));  // -12 from +48
    }

    // CRYSTAL TEXTURE — delicate 16th arps in intense sections
    const crystalN: MidiNote[] = [];
    const crystalPool = [[62, 65, 69, 72], [67, 70, 74, 77], [69, 72, 76, 79], [70, 74, 77, 81]];
    let cStep = 0;
    for (let b = 192; b < 512; b += 0.5) {
        if (b >= 320 && b < 384) continue;
        const ci = Math.floor(b / 16) % 4;
        const pool = crystalPool[ci]!;
        const pitch = pool[cStep % pool.length]! + 12;
        const vel = b >= 224 && b < 320 ? 48 : b >= 384 ? 42 : 35;
        crystalN.push(note(pitch, b, 0.4, hv(vel)));
        cStep++;
    }

    // TREMOLO PULSE — rhythmic chord pulses with tremolo effect
    const tremN: MidiNote[] = [];
    for (let b = 128; b < 384; b += 4) {
        if (b >= 320 && b < 384) continue;
        const c = ch(b);
        const vel = b >= 224 ? 60 : 48;
        tremN.push(note(c.fifth + 24, b, 0.3, hv(vel)));
        tremN.push(note(c.fifth + 24, b + 1.5, 0.3, hv(vel - 8)));
        tremN.push(note(c.root + 24, b + 2.5, 0.3, hv(vel - 5)));
    }

    // WIDE CHORUS PAD — slow evolving 5ths with deep chorus
    const wideN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 32) {
        const c = ch(b);
        const inBD = b >= 320 && b < 384;
        const vel = inBD ? 28 : b >= 512 ? 35 : 48;
        wideN.push(note(c.root + 12, b, 31, hv(vel)));
        wideN.push(note(c.fifth + 12, b, 31, hv(vel - 5)));
        if (!inBD) wideN.push(note(c.ninth + 12, b, 31, hv(vel - 10)));
    }

    // DRUM FILLS — minimal tom accents at section boundaries (not busy 16th fills)
    const drumFillN: MidiNote[] = [];
    const fillBeats = [112, 192, 288, 368, 448, 544];
    for (const fb of fillBeats) {
        if (fb >= 576) break;
        if (fb >= 320 && fb < 384) continue;
        // Simple 3-hit fill: low tom, mid tom, floor tom
        drumFillN.push(note(43, fb, 0.5, hv(62)));
        drumFillN.push(note(47, fb + 1, 0.5, hv(58)));
        drumFillN.push(note(50, fb + 2, 0.5, hv(55)));
        drumFillN.push(note(36, fb + 3, 1.0, hv(75))); // resolving kick
    }

    // IMPACT FX — sub bass drops at section changes
    const impactN: MidiNote[] = [];
    const impactBeats = [64, 128, 224, 384, 512];
    for (const ib of impactBeats) {
        const c = ch(ib);
        impactN.push(note(c.sub, ib, 4, 100)); // deep sub hit
        impactN.push(note(c.sub + 12, ib + 0.05, 2, 70)); // harmonic layer
    }

    // TEXTURE CHIRPS — random high-pitched pluck sounds
    const chirpN: MidiNote[] = [];
    const chirpPitches = [86, 88, 89, 91, 93, 95, 98]; // D minor, octave 6-7
    for (let b = 128; b < 512; b += 2) {
        if (b >= 320 && b < 384) continue;
        if (Math.random() < 0.15) {
            const pitch = chirpPitches[Math.floor(Math.random() * chirpPitches.length)]!;
            chirpN.push(note(pitch, b + Math.random() * 0.5, 0.05, hv(30, 5)));
        }
    }

    // ── TRACK ASSEMBLY ────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        drumFolder, drumKitTrack, percShakerTrack, percHitsTrack,
        bassFolder, subBassTrack, bassSynthTrack, pulseBassTrack,
        keysFolder, pianoTrack, rhodesTrack, organTrack,
        strPadFolder, warmPadTrack, shimmerPadTrack, darkPadTrack, stringsSoftTrack, stringsBrightTrack,
        leadsFolder, leadClassicTrack, leadSoftTrack, brassTrack, arpTrack,
        flourishFolder, fluteTrack, bellAccentTrack, crystalTexTrack, tremPulseTrack, widePadTrack,
        drumFillTrack, impactFxTrack, texChirpTrack,
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
            [fluteClip.id]: fluteN.map(n => ({ ...n, startBeat: n.startBeat - 128 })),
            [bellAccClip.id]: bellAccN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [crystalClip.id]: crystalN.map(n => ({ ...n, startBeat: n.startBeat - 192 })),
            [tremPulseClip.id]: tremN.map(n => ({ ...n, startBeat: n.startBeat - 128 })),
            [widePadClip.id]: wideN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [drumFillClip.id]: drumFillN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [impactClip.id]: impactN.map(n => ({ ...n, startBeat: n.startBeat - 64 })),
            [chirpClip.id]: chirpN.map(n => ({ ...n, startBeat: n.startBeat - 128 })),
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

    // Remove hatPan — was making drums oscillate unnaturally
    // (hatPan automation deleted)

    const pulseFilter = mkLane(pulseBassTrack.id, 'filterCutoff', 'Filter', 20, 20000);
    pulseFilter.points = [
        { beat: 32, value: 100, curve: 'linear', tension: 0 },
        { beat: 64, value: 400, curve: 'linear', tension: 0 },
        { beat: 128, value: 2000, curve: 'linear', tension: 0 },
        { beat: 200, value: 6000, curve: 'linear', tension: 0 },
        { beat: 224, value: 10000, curve: 'linear', tension: 0 },   // WOW: filter fully opens at catharsis
        { beat: 320, value: 100, curve: 'linear', tension: 0 },    // CRASH: slams shut at breakdown
        { beat: 384, value: 800, curve: 'linear', tension: 0 },
        { beat: 448, value: 8000, curve: 'linear', tension: 0 },
        { beat: 512, value: 1500, curve: 'linear', tension: 0 },
        { beat: TB, value: 80, curve: 'linear', tension: 0 },
    ];

    // ── TEXTURE TRACK MIDI PATTERNS (Transition Fills) ───────────────────
    const arpAN: MidiNote[] = [];
    const arpBN: MidiNote[] = [];
    const rStabAN: MidiNote[] = [];
    const rStabBN: MidiNote[] = [];
    const bScatN: MidiNote[] = [];
    const gSwellN: MidiNote[] = [];
    const malTapN: MidiNote[] = [];
    const pizzN: MidiNote[] = [];
    const chimeN: MidiNote[] = [];
    const microN: MidiNote[] = [];

    // Fills occur every 8 bars (32 beats) to enrich transitions
    for (let b = 64; b < 512; b += 32) {
        if (b >= 320 && b < 384) continue; // skip breakdown
        const c = ch(b);
        const isMajorChange = b % 64 === 0;

        // Pluck Arps (ascending A, descending B logic)
        arpAN.push(note(c.root + 12, b - 1, 0.2, hv(70, 5)));
        arpAN.push(note(c.fifth + 12, b - 0.5, 0.2, hv(65, 5)));
        arpAN.push(note(c.ninth + 12, b, 0.5, hv(80, 5)));

        arpBN.push(note(c.ninth + 24, b + 15, 0.2, hv(65, 5)));
        arpBN.push(note(c.fifth + 24, b + 15.5, 0.2, hv(60, 5)));
        arpBN.push(note(c.third + 24, b + 16, 0.5, hv(75, 5)));

        // Rhodes Stabs (Call and response)
        if (isMajorChange) {
            rStabAN.push(note(c.root + 12, b, 2, hv(85, 5)));
            rStabAN.push(note(c.fifth + 12, b, 2, hv(80, 5)));
            rStabBN.push(note(c.ninth + 12, b + 2, 2, hv(70, 5)));
        }

        // Bell Scatter (randomized high sprinkles)
        bScatN.push(note(c.fifth + 24, b - 0.25, 0.1, hv(60, 10)));
        bScatN.push(note(c.ninth + 24, b, 0.1, hv(70, 10)));
        bScatN.push(note(c.third + 36, b + 0.5, 0.1, hv(55, 10)));

        // Glass Swells (leading into sections)
        gSwellN.push(note(c.root + 24, b - 2, 4, hv(60, 5)));

        // Mallet Taps (rhythmic syncopation)
        malTapN.push(note(c.root + 12, b + 7.5, 0.1, hv(75, 5)));
        malTapN.push(note(c.fifth + 12, b + 8, 0.1, hv(85, 5)));

        // Pizz Layer (doubling string rhythms)
        if (b >= 128) {
            pizzN.push(note(c.root + 12, b, 0.1, hv(70, 5)));
            pizzN.push(note(c.fifth + 12, b + 1.5, 0.1, hv(65, 5)));
        }

        // Chime Drops (single high marker)
        if (isMajorChange) {
            chimeN.push(note(c.root + 36, b, 4, hv(90, 5)));
        }

        // Micro Perc (electronic glitches)
        microN.push(note(c.root + 24, b + 3.75, 0.05, hv(60, 5)));
        microN.push(note(c.fifth + 24, b + 3.875, 0.05, hv(50, 5)));
    }
    (pluckArpAClip as any).notes = arpAN;
    (pluckArpBClip as any).notes = arpBN;
    (rhodesStabAClip as any).notes = rStabAN;
    (rhodesStabBClip as any).notes = rStabBN;
    (bellScatterClip as any).notes = bScatN;
    (glassSwellClip as any).notes = gSwellN;
    (malletTapClip as any).notes = malTapN;
    (pizzLayerClip as any).notes = pizzN;
    (chimeDropClip as any).notes = chimeN;
    (microPercClip as any).notes = microN;

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

    // Flute volume: swell in catharsis, gentle throughout
    const fluteVol = mkLane(fluteTrack.id, 'volume', 'Volume', 0, 1);
    fluteVol.points = [
        { beat: 128, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 312, value: 0.75, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.0, curve: 'linear', tension: 0 },
    ];

    // Crystal texture volume: crescendo into catharsis
    const crystalVol = mkLane(crystalTexTrack.id, 'volume', 'Volume', 0, 1);
    crystalVol.points = [
        { beat: 192, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 220, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 312, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 400, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.0, curve: 'linear', tension: 0 },
    ];

    // Wide pad volume: slow build, stays through outro
    const wideVol = mkLane(widePadTrack.id, 'volume', 'Volume', 0, 1);
    wideVol.points = [
        { beat: 64, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.45, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.1, curve: 'linear', tension: 0 },
    ];

    // Tremolo Pulse: enters and exits with groove
    const tremVol = mkLane(tremPulseTrack.id, 'volume', 'Volume', 0, 1);
    tremVol.points = [
        { beat: 128, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 160, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 310, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 },
    ];

    // Bell accents: barely-there background texture
    const bellAccVol = mkLane(bellAccentTrack.id, 'volume', 'Volume', 0, 1);
    bellAccVol.points = [
        { beat: 64, value: 0.0, curve: 'linear', tension: 0 },
        { beat: 96, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.10, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.03, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.08, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.05, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.02, curve: 'linear', tension: 0 },
    ];

    // ── DRAMATIC AUTOMATION (audible wow moments, Kiasmos/Jon Hopkins style) ──

    // Warm pad reverb mix: DRAMATIC — intimate to cathedral
    const warmRevMix = mkLane(warmPadTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    warmRevMix.points = [
        { beat: 0, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 200, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.55, curve: 'linear', tension: 0 },   // WOW: reverb swells into catharsis
        { beat: 288, value: 0.65, curve: 'linear', tension: 0 },   // Peak reverb wash
        { beat: 320, value: 0.08, curve: 'linear', tension: 0 },   // SNAP: dry at breakdown
        { beat: 384, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.7, curve: 'linear', tension: 0 },    // Outro: dissolves into reverb
    ];

    // Arp delay feedback: builds to near-self-oscillation then CUT
    const arpDelayFb = mkLane(arpTrack.id, 'delay-feedback', 'Delay FB', 0, 0.95);
    arpDelayFb.points = [
        { beat: 64, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 200, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 220, value: 0.75, curve: 'linear', tension: 0 },   // Building cascades
        { beat: 224, value: 0.85, curve: 'linear', tension: 0 },   // WOW: near self-oscillation!
        { beat: 310, value: 0.88, curve: 'linear', tension: 0 },   // Held at edge
        { beat: 320, value: 0.1, curve: 'linear', tension: 0 },    // SNAP: cut to almost nothing
        { beat: 400, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.2, curve: 'linear', tension: 0 },
    ];

    // Lead reverb mix: massive contrast — dry intimate vs huge space
    const leadRevMix = mkLane(leadClassicTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    leadRevMix.points = [
        { beat: 160, value: 0.08, curve: 'linear', tension: 0 },    // Starts dry/intimate
        { beat: 192, value: 0.12, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.45, curve: 'linear', tension: 0 },    // WOW: huge reverb at catharsis
        { beat: 288, value: 0.55, curve: 'linear', tension: 0 },    // Peak space
        { beat: 320, value: 0.05, curve: 'linear', tension: 0 },    // SNAP: completely dry
        { beat: 416, value: 0.2, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.6, curve: 'linear', tension: 0 },     // Dissolves
    ];

    // Dark pad distortion drive: ramps up into catharsis (sinister growl)
    const darkDrive = mkLane(darkPadTrack.id, 'dist-drive', 'Drive', 0.1, 20);
    darkDrive.points = [
        { beat: 192, value: 1, curve: 'linear', tension: 0 },
        { beat: 220, value: 3, curve: 'linear', tension: 0 },
        { beat: 224, value: 8, curve: 'linear', tension: 0 },      // WOW: distortion kicks in hard
        { beat: 280, value: 12, curve: 'linear', tension: 0 },     // Peak grit
        { beat: 320, value: 1, curve: 'linear', tension: 0 },      // Clean at breakdown
        { beat: 384, value: 2, curve: 'linear', tension: 0 },
    ];

    // Extreme Automations (Jon Hopkins / Kiasmos style)
    const widePadMix = mkLane(widePadTrack.id, 'chorus-mix', 'Chorus Wash', 0, 1);
    widePadMix.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.95, curve: 'linear', tension: 0 },   // Total wash
        { beat: 320, value: 0.05, curve: 'linear', tension: 0 },
    ];

    const shimmerDepth = mkLane(shimmerPadTrack.id, 'rev-damping', 'Shimmer Open', 0, 1);
    shimmerDepth.points = [
        { beat: 64, value: 0.8, curve: 'linear', tension: 0 },     // Muffled
        { beat: 224, value: 0.1, curve: 'linear', tension: 0 },    // Bright/open
        { beat: 320, value: 0.9, curve: 'linear', tension: 0 },
    ];

    const pulseFb = mkLane(pulseBassTrack.id, 'filter-resonance', 'Pulse Res', 0, 20);
    pulseFb.points = [
        { beat: 64, value: 1, curve: 'linear', tension: 0 },
        { beat: 224, value: 15, curve: 'linear', tension: 0 },     // Screaming resonance
        { beat: 320, value: 0, curve: 'linear', tension: 0 },
        { beat: 512, value: 12, curve: 'linear', tension: 0 },
    ];

    // Delay mix on crystal texture: scattered → dense → gone
    const crystalDelayMix = mkLane(crystalTexTrack.id, 'delay-mix', 'Delay Mix', 0, 1);
    crystalDelayMix.points = [
        { beat: 192, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.5, curve: 'linear', tension: 0 },     // WOW: dense cascading delays
        { beat: 288, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 },     // CUT
        { beat: 400, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.0, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            subVol, warmVol, drumVol, strSoftVol, arpVol, leadVol,
            pianoVol, brassVol, darkVol, rhodesVol, shimmerVol,
            pulseFilter, leadSoftVol, strBrightVol,
            fluteVol, crystalVol, wideVol, tremVol, bellAccVol,
            // Dramatic effect automation
            warmRevMix, arpDelayFb, leadRevMix, darkDrive, crystalDelayMix,
            widePadMix, shimmerDepth, pulseFb
        ],
    });


    automationStore.set({
        lanes: [
            subVol, warmVol, drumVol, strSoftVol, arpVol, leadVol,
            pianoVol, brassVol, darkVol, rhodesVol, shimmerVol,
            pulseFilter, leadSoftVol, strBrightVol,
            fluteVol, crystalVol, wideVol, tremVol, bellAccVol,
            // Dramatic effect automation
            warmRevMix, arpDelayFb, leadRevMix, darkDrive, crystalDelayMix,
            widePadMix, shimmerDepth, pulseFb
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

    // Bootstrap device audio nodes from store state
    const { ensureTrackStrips } = await import('#/modules/Transport/useCases/ensureTrackStrips');
    ensureTrackStrips();

    // Await all internal async device creations (e.g. Faust WASM compilation)
    const { waitForDevices } = await import('#/modules/AudioEngine/useCases/engineAccess');
    await waitForDevices();

    projectStore.set({ name: 'Resonance (Demo)', createdAt: Date.now(), updatedAt: Date.now(), dirty: false, loading: false });
}


// ---------------------------------------------------------------------------
// Demo Project 2: Electronic Beat
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Demo Project 2: Psytrance — "Psyloops"
// Key: A minor | BPM: 142 | ~5:04 (720 beats)
// Structure: Intro(0-64) → Build(64-128) → Drop A(128-256) →
//            Breakdown(256-320) → Drop B(320-448) → Chaos(448-512) →
//            Breakdown 2(512-576) → Final Drop+Outro(576-720)
// ---------------------------------------------------------------------------

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

