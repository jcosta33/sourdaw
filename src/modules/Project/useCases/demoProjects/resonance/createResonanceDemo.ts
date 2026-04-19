import { trackStore, markerStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectStore } from '../../../stores/projectStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import { note } from '../demoUtils/note';
import { applyPreset } from '../demoUtils/applyPreset';
import { createAudioClip } from '../demoUtils/createAudioClip';
import { createMidiClip } from '../demoUtils/createMidiClip';
import { generateDemoDrumBuffer } from '../demoUtils/generateDemoDrumBuffer';
import { syncArrangement } from '../demoUtils/syncArrangement';
import type { MidiNote } from '../../../models/DemoProjectTypes';
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
    // 808 Bass removed — didn't add to the mix

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
    const fluteTrack = createTrack({ name: 'Sine Counter', kind: 'midi', parentId: flourishFolder.id });
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

    // 🌊 Deep Layers folder — 10 subliminal texture/depth tracks
    const deepFolder = createTrack({ name: '🌊 Deep Layers', kind: 'folder' });
    const tapeHissTrack = createTrack({ name: 'Tape Hiss', kind: 'audio', parentId: deepFolder.id });
    const granStutterTrack = createTrack({ name: 'Granular Stutter', kind: 'midi', parentId: deepFolder.id });
    const polyClickTrack = createTrack({ name: 'Polyrhythmic Click', kind: 'midi', parentId: deepFolder.id });
    const revSwellTrack = createTrack({ name: 'Reversed Swell', kind: 'midi', parentId: deepFolder.id });
    const modSeqTrack = createTrack({ name: 'Modular Sequence', kind: 'midi', parentId: deepFolder.id });
    const breathPadTrack = createTrack({ name: 'Breath Pad', kind: 'midi', parentId: deepFolder.id });
    const subRumbleTrack = createTrack({ name: 'Sub Rumble', kind: 'midi', parentId: deepFolder.id });
    const metalRingTrack = createTrack({ name: 'Metallic Ring', kind: 'midi', parentId: deepFolder.id });
    const ghostSnareTrack = createTrack({ name: 'Ghost Snare', kind: 'midi', parentId: deepFolder.id });
    const harmWashTrack = createTrack({ name: 'Harmonic Wash', kind: 'midi', parentId: deepFolder.id });

    // ── PRESETS (Faust instruments for key tracks) ─────────────────────────
    // 808 Kit: type must be builtin-drum-kit for the drum engine
    drumKitTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    applyPreset(subBassTrack, 'factory-bass-sub');
    // ▸ Faust Acid Bass 303 — authentic squelchy acid bass
    applyPreset(pianoTrack, 'factory-keys-bell'); // sine bell — smooth with natural decay
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
    applyPreset(fluteTrack, 'factory-faust-fm-shimmer-pad');
    // ▸ Faust DX Bells — crystalline FM bell tones
    applyPreset(bellAccentTrack, 'factory-faust-fm-dx-bells');
    applyPreset(crystalTexTrack, 'factory-keys-marimba'); // sine percussive — organic, not sustained
    applyPreset(tremPulseTrack, 'factory-keys-pluck'); // triangle pluck — natural decay
    // ▸ Faust Supersaw Pad — massive detuned pad with reverb
    applyPreset(widePadTrack, 'factory-faust-supersaw-pad');
    // Drum Fills: same 808 kit for fills
    drumFillTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
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
    // ── DEEP LAYERS PRESETS ─────────────────────────────────────────────
    // Tape Hiss is audio — no preset needed
    applyPreset(granStutterTrack, 'factory-keys-pluck');
    applyPreset(polyClickTrack, 'factory-keys-marimba');
    applyPreset(revSwellTrack, 'factory-pad-warm');
    applyPreset(modSeqTrack, 'factory-faust-acid-liquid');
    applyPreset(breathPadTrack, 'factory-faust-supersaw-pad');
    applyPreset(subRumbleTrack, 'factory-bass-sub');
    applyPreset(metalRingTrack, 'factory-faust-fm-dx-bells');
    ghostSnareTrack.devices = [
        {
            id: `dev-${crypto.randomUUID()}`,
            name: '808 Kit',
            type: 'builtin-drum-kit',
            bypassed: false,
            parameterValues: { kit: 0 },
        },
    ];
    applyPreset(harmWashTrack, 'factory-faust-additive-glass');
    // ── EFFECTS on tracks (web-compatible only) ──────────────────────────
    const addDev = (t: any, type: string, name: string, params: Record<string, number>) => {
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
    };

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  MASTER CHAIN — Kiasmos/Jon Hopkins style mastering        ║
    // ╚═══════════════════════════════════════════════════════════════╝
    addDev(masterTrack, 'builtin-eq', 'Master EQ', {
        'eq-low-gain': 1.5,
        'eq-low-freq': 80,
        'eq-low-q': 0.8,
        'eq-mid-gain': -1,
        'eq-mid-freq': 400,
        'eq-mid-q': 1.2,
        'eq-high-gain': 2,
        'eq-high-freq': 10000,
        'eq-high-q': 0.7,
    });
    addDev(masterTrack, 'builtin-compressor', 'Glue Comp', {
        'comp-threshold': -12,
        'comp-ratio': 2.5,
        'comp-attack': 30,
        'comp-release': 200,
        'comp-knee': 10,
        'comp-makeup': 2,
    });
    addDev(masterTrack, 'builtin-stereo-widener', 'Width', {
        'width-amount': 1.15,
        'width-mid': 0,
        'width-side': 1.5,
        'width-mono-bass': 180,
    });
    addDev(masterTrack, 'builtin-limiter', 'Brickwall', { 'lim-threshold': -1 });
    addDev(masterTrack, 'builtin-lufs-meter', 'LUFS', { 'lufs-target': -14 });

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  MIX BUS PROCESSING — depth, width, glue                  ║
    // ╚═══════════════════════════════════════════════════════════════╝
    // Drums: EQ scoop + gentle compression for punch
    addDev(drumKitTrack, 'builtin-eq', 'Drum EQ', {
        'eq-low-gain': 3,
        'eq-low-freq': 60,
        'eq-low-q': 1,
        'eq-mid-gain': -2,
        'eq-mid-freq': 350,
        'eq-mid-q': 1.5,
        'eq-high-gain': 1,
        'eq-high-freq': 8000,
        'eq-high-q': 0.8,
    });
    // Reverb bus: convolution reverb (Studio A) for shared depth
    addDev(reverbBusTrack, 'builtin-convolution-reverb', 'Room IR', {
        'conv-ir': 6,
        'conv-mix': 0.5,
        'conv-predelay': 25,
        'conv-lowcut': 80,
        'conv-highcut': 10000,
    });
    // Warm Pad: EQ for warmth and air (boost low-mids + gentle high shelf)
    addDev(warmPadTrack, 'builtin-eq', 'Pad Warmth', {
        'eq-low-gain': 2,
        'eq-low-freq': 200,
        'eq-low-q': 0.8,
        'eq-mid-gain': -1.5,
        'eq-mid-freq': 800,
        'eq-mid-q': 1.2,
        'eq-high-gain': 1.5,
        'eq-high-freq': 8000,
        'eq-high-q': 0.6,
    });

    // ╔═══════════════════════════════════════════════════════════════╗
    // ║  PER-TRACK EFFECTS — character, space, movement            ║
    // ╚═══════════════════════════════════════════════════════════════╝
    // Lead (Moog): dotted delay + chorus + filtered reverb
    addDev(leadClassicTrack, 'builtin-delay', 'Dotted Delay', {
        'delay-time': 375,
        'delay-feedback': 0.3,
        'delay-mix': 0.2,
    });
    addDev(leadClassicTrack, 'builtin-chorus', 'Lead Chorus', {
        'chorus-rate': 0.6,
        'chorus-depth': 5,
        'chorus-feedback': 0.15,
        'chorus-mix': 0.25,
    });
    addDev(leadClassicTrack, 'builtin-reverb', 'Lead Space', {
        'rev-size': 0.6,
        'rev-decay': 3,
        'rev-damping': 0.3,
        'rev-mix': 0.25,
    });
    // Lead Soft: phaser + reverb for dreamy Jon Hopkins quality (lower wet to avoid mud)
    addDev(leadSoftTrack, 'builtin-phaser', 'Dream Phase', {
        'phaser-rate': 0.15,
        'phaser-depth': 0.8,
        'phaser-feedback': 0.55,
        'phaser-stages': 6,
    });
    addDev(leadSoftTrack, 'builtin-reverb', 'Soft Hall', {
        'rev-size': 0.8,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.22,
    });
    // Brass: reverb + EQ brightening for grandeur
    addDev(brassTrack, 'builtin-reverb', 'Brass Hall', {
        'rev-size': 0.65,
        'rev-decay': 2.5,
        'rev-damping': 0.3,
        'rev-mix': 0.25,
    });
    // Rhodes (Faust Ambient): chorus + delay for warmth and movement
    addDev(rhodesTrack, 'builtin-chorus', 'Rhodes Shimmer', {
        'chorus-rate': 0.35,
        'chorus-depth': 4,
        'chorus-feedback': 0.12,
        'chorus-mix': 0.25,
    });
    addDev(rhodesTrack, 'builtin-delay', 'Rhodes Echo', {
        'delay-time': 375,
        'delay-feedback': 0.25,
        'delay-mix': 0.18,
    });
    // Piano: convolution reverb for natural room
    addDev(pianoTrack, 'builtin-convolution-reverb', 'Piano Room', {
        'conv-ir': 0,
        'conv-mix': 0.25,
        'conv-predelay': 10,
        'conv-lowcut': 100,
        'conv-highcut': 12000,
    });
    // Arp: phaser + ping-pong delay for spatial movement
    addDev(arpTrack, 'builtin-phaser', 'Arp Phase', {
        'phaser-rate': 0.3,
        'phaser-depth': 0.5,
        'phaser-feedback': 0.35,
        'phaser-stages': 4,
    });
    addDev(arpTrack, 'builtin-delay', 'Arp Delay', { 'delay-time': 188, 'delay-feedback': 0.4, 'delay-mix': 0.25 });
    addDev(arpTrack, 'builtin-autopan', 'Arp Pan', { 'autopan-rate': 0.5, 'autopan-depth': 0.6 });
    // Shimmer Pad (Faust FM): chorus for extra shimmer
    addDev(shimmerPadTrack, 'builtin-chorus', 'Shimmer Chorus', {
        'chorus-rate': 0.15,
        'chorus-depth': 10,
        'chorus-feedback': 0.2,
        'chorus-mix': 0.35,
    });
    // Warm Pad: slow flanger for evolving texture (Kiasmos trick) + reverb
    addDev(warmPadTrack, 'builtin-flanger', 'Pad Flange', {
        'flanger-rate': 0.06,
        'flanger-depth': 5,
        'flanger-feedback': 0.35,
        'flanger-mix': 0.2,
    });
    addDev(warmPadTrack, 'builtin-reverb', 'Pad Reverb', {
        'rev-size': 0.9,
        'rev-decay': 5,
        'rev-damping': 0.15,
        'rev-mix': 0.2,
    });
    // Dark Pad: phaser + distortion for sinister texture (Jon Hopkins "Immunity" style)
    addDev(darkPadTrack, 'builtin-phaser', 'Dark Phase', {
        'phaser-rate': 0.08,
        'phaser-depth': 0.9,
        'phaser-feedback': 0.65,
        'phaser-stages': 6,
    });
    addDev(darkPadTrack, 'builtin-distortion', 'Dark Saturation', {
        'dist-drive': 2,
        'dist-tone': 2000,
        'dist-mix': 0.1,
        'dist-output': -3,
    });
    // Strings Soft: lush reverb
    addDev(stringsSoftTrack, 'builtin-reverb', 'Strings Hall', {
        'rev-size': 0.85,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.3,
    });
    // Strings Bright: reverb + chorus + EQ presence
    addDev(stringsBrightTrack, 'builtin-reverb', 'Bright Hall', {
        'rev-size': 0.7,
        'rev-decay': 2.5,
        'rev-damping': 0.2,
        'rev-mix': 0.25,
    });
    addDev(stringsBrightTrack, 'builtin-chorus', 'Bright Chorus', {
        'chorus-rate': 0.3,
        'chorus-depth': 6,
        'chorus-mix': 0.2,
    });

    // Organ (Faust Hammond): already has Leslie, add tremolo override
    addDev(organTrack, 'builtin-tremolo', 'Leslie Trem', { 'trem-rate': 5.5, 'trem-depth': 0.3, 'trem-shape': 0 });
    // Flute: delay + reverb for floating quality
    addDev(fluteTrack, 'builtin-delay', 'Flute Echo', { 'delay-time': 330, 'delay-feedback': 0.35, 'delay-mix': 0.22 });
    addDev(fluteTrack, 'builtin-reverb', 'Flute Space', {
        'rev-size': 0.7,
        'rev-decay': 3,
        'rev-damping': 0.3,
        'rev-mix': 0.3,
    });
    // Bell Accents (Faust DX Bells): already has reverb from preset, add shimmer delay
    addDev(bellAccentTrack, 'builtin-delay', 'Bell Echo', {
        'delay-time': 500,
        'delay-feedback': 0.35,
        'delay-mix': 0.25,
    });
    // Crystal Texture: delay + reverb (tamed wet) + auto-pan for scattered texture
    addDev(crystalTexTrack, 'builtin-delay', 'Crystal Delay', {
        'delay-time': 200,
        'delay-feedback': 0.5,
        'delay-mix': 0.3,
    });
    addDev(crystalTexTrack, 'builtin-reverb', 'Crystal Wash', {
        'rev-size': 0.95,
        'rev-decay': 5,
        'rev-damping': 0.15,
        'rev-mix': 0.22,
    });
    addDev(crystalTexTrack, 'builtin-autopan', 'Crystal Pan', { 'autopan-rate': 0.3, 'autopan-depth': 0.5 });
    // Tremolo Pulse: tremolo + phaser
    addDev(tremPulseTrack, 'builtin-tremolo', 'Pulse Trem', { 'trem-rate': 3, 'trem-depth': 0.6, 'trem-shape': 0 });
    addDev(tremPulseTrack, 'builtin-phaser', 'Pulse Phase', {
        'phaser-rate': 0.2,
        'phaser-depth': 0.6,
        'phaser-feedback': 0.4,
        'phaser-stages': 4,
    });
    // Wide Pad (Faust Supersaw): already has reverb, add deep chorus
    addDev(widePadTrack, 'builtin-chorus', 'Wide Chorus', {
        'chorus-rate': 0.15,
        'chorus-depth': 14,
        'chorus-feedback': 0.3,
        'chorus-mix': 0.5,
    });
    // Drum Fills: reverb on fills for space
    addDev(drumFillTrack, 'builtin-reverb', 'Fill Verb', {
        'rev-size': 0.4,
        'rev-decay': 1.2,
        'rev-damping': 0.5,
        'rev-mix': 0.2,
    });
    // Impact FX: reverb (tamed) + distortion for impact weight
    addDev(impactFxTrack, 'builtin-reverb', 'Impact Tail', {
        'rev-size': 0.95,
        'rev-decay': 5,
        'rev-damping': 0.1,
        'rev-mix': 0.3,
    });
    addDev(impactFxTrack, 'builtin-distortion', 'Impact Drive', {
        'dist-drive': 4,
        'dist-tone': 1500,
        'dist-mix': 0.12,
    });
    // Texture Chirps (Faust Additive Glass): delay + autopan for scattered glass
    addDev(texChirpTrack, 'builtin-delay', 'Chirp Delay', {
        'delay-time': 166,
        'delay-feedback': 0.5,
        'delay-mix': 0.35,
    });
    addDev(texChirpTrack, 'builtin-autopan', 'Chirp Pan', { 'autopan-rate': 2, 'autopan-depth': 0.8 });
    // Noise Sweep: bitcrusher for lo-fi texture
    addDev(noiseSweepTrack, 'builtin-bitcrusher', 'Noise Crush', {
        'crush-bits': 6,
        'crush-rate': 8,
        'crush-mix': 0.15,
    });
    // Riser: filter + reverb for sweeping builds
    addDev(riserTrack, 'builtin-filter', 'Rise Filter', {
        'filter-cutoff': 500,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(riserTrack, 'builtin-reverb', 'Rise Space', {
        'rev-size': 0.8,
        'rev-decay': 3,
        'rev-damping': 0.3,
        'rev-mix': 0.3,
    });
    // ── TEXTURE TRACK EFFECTS ─────────────────────────────────────────────
    addDev(pluckArpATrack, 'builtin-delay', 'Pluck Delay', {
        'delay-time': 250,
        'delay-feedback': 0.4,
        'delay-mix': 0.3,
    });
    addDev(pluckArpATrack, 'builtin-reverb', 'Pluck Space', {
        'rev-size': 0.6,
        'rev-decay': 2,
        'rev-damping': 0.3,
        'rev-mix': 0.2,
    });
    addDev(pluckArpBTrack, 'builtin-delay', 'Pluck Echo', {
        'delay-time': 375,
        'delay-feedback': 0.45,
        'delay-mix': 0.35,
    });
    addDev(pluckArpBTrack, 'builtin-chorus', 'Pluck Chorus', {
        'chorus-rate': 0.3,
        'chorus-depth': 5,
        'chorus-mix': 0.2,
    });
    addDev(rhodesStabATrack, 'builtin-chorus', 'Stab Chorus', {
        'chorus-rate': 0.8,
        'chorus-depth': 6,
        'chorus-mix': 0.3,
    });
    addDev(rhodesStabATrack, 'builtin-reverb', 'Stab Verb', {
        'rev-size': 0.7,
        'rev-decay': 2.5,
        'rev-damping': 0.25,
        'rev-mix': 0.25,
    });
    addDev(rhodesStabBTrack, 'builtin-delay', 'Stab Echo', {
        'delay-time': 333,
        'delay-feedback': 0.35,
        'delay-mix': 0.3,
    });
    addDev(rhodesStabBTrack, 'builtin-chorus', 'Ghost Chorus', {
        'chorus-rate': 1.2,
        'chorus-depth': 8,
        'chorus-mix': 0.4,
    });
    addDev(bellScatterTrack, 'builtin-delay', 'Bell Scatter', {
        'delay-time': 166,
        'delay-feedback': 0.55,
        'delay-mix': 0.4,
    });
    addDev(bellScatterTrack, 'builtin-reverb', 'Bell Wash', {
        'rev-size': 0.9,
        'rev-decay': 4,
        'rev-damping': 0.2,
        'rev-mix': 0.3,
    });
    addDev(glassSwellTrack, 'builtin-reverb', 'Glass Verb', {
        'rev-size': 0.95,
        'rev-decay': 6,
        'rev-damping': 0.1,
        'rev-mix': 0.4,
    });
    addDev(glassSwellTrack, 'builtin-chorus', 'Glass Shimmer', {
        'chorus-rate': 0.2,
        'chorus-depth': 12,
        'chorus-mix': 0.35,
    });
    addDev(malletTapTrack, 'builtin-delay', 'Mallet Echo', {
        'delay-time': 125,
        'delay-feedback': 0.3,
        'delay-mix': 0.25,
    });
    addDev(pizzLayerTrack, 'builtin-reverb', 'Pizz Space', {
        'rev-size': 0.5,
        'rev-decay': 1.5,
        'rev-damping': 0.4,
        'rev-mix': 0.2,
    });
    addDev(chimeDropTrack, 'builtin-delay', 'Chime Trail', {
        'delay-time': 500,
        'delay-feedback': 0.5,
        'delay-mix': 0.4,
    });
    addDev(chimeDropTrack, 'builtin-reverb', 'Chime Space', {
        'rev-size': 0.95,
        'rev-decay': 5,
        'rev-damping': 0.15,
        'rev-mix': 0.35,
    });
    addDev(microPercTrack, 'builtin-delay', 'Micro Echo', {
        'delay-time': 83,
        'delay-feedback': 0.4,
        'delay-mix': 0.3,
    });
    addDev(microPercTrack, 'builtin-phaser', 'Micro Phase', {
        'phaser-rate': 0.4,
        'phaser-depth': 0.7,
        'phaser-feedback': 0.5,
        'phaser-stages': 4,
    });
    // ── DEEP LAYERS EFFECTS ─────────────────────────────────────────────
    // Granular Stutter: bitcrusher + delay for stuttered lofi texture
    addDev(granStutterTrack, 'builtin-bitcrusher', 'Stutter Crush', {
        'crush-bits': 12,
        'crush-rate': 4,
        'crush-mix': 0.4,
    });
    addDev(granStutterTrack, 'builtin-delay', 'Stutter Echo', {
        'delay-time': 83,
        'delay-feedback': 0.6,
        'delay-mix': 0.35,
    });
    // Polyrhythmic Click: delay + reverb for spatial clicking
    addDev(polyClickTrack, 'builtin-delay', 'Click Delay', {
        'delay-time': 166,
        'delay-feedback': 0.3,
        'delay-mix': 0.2,
    });
    addDev(polyClickTrack, 'builtin-reverb', 'Click Space', {
        'rev-size': 0.3,
        'rev-decay': 1,
        'rev-damping': 0.3,
        'rev-mix': 0.15,
    });
    // Reversed Swell: massive reverb + chorus for swelling textures
    addDev(revSwellTrack, 'builtin-reverb', 'Swell Verb', {
        'rev-size': 0.9,
        'rev-decay': 8,
        'rev-damping': 0.1,
        'rev-mix': 0.5,
    });
    addDev(revSwellTrack, 'builtin-chorus', 'Swell Chorus', {
        'chorus-rate': 0.3,
        'chorus-depth': 10,
        'chorus-mix': 0.4,
    });
    // Modular Sequence: filter + delay for stepped acid sequences
    addDev(modSeqTrack, 'builtin-filter', 'Mod Filter', {
        'filter-cutoff': 2000,
        'filter-resonance': 4,
        'filter-type': 0,
    });
    addDev(modSeqTrack, 'builtin-delay', 'Mod Echo', { 'delay-time': 250, 'delay-feedback': 0.45, 'delay-mix': 0.3 });
    // Breath Pad: tremolo + chorus + reverb for breathing texture
    addDev(breathPadTrack, 'builtin-tremolo', 'Breath Trem', { 'trem-rate': 0.15, 'trem-depth': 0.6, 'trem-shape': 0 });
    addDev(breathPadTrack, 'builtin-chorus', 'Breath Chorus', {
        'chorus-rate': 0.2,
        'chorus-depth': 12,
        'chorus-mix': 0.5,
    });
    addDev(breathPadTrack, 'builtin-reverb', 'Breath Hall', {
        'rev-size': 0.85,
        'rev-decay': 10,
        'rev-damping': 0.1,
        'rev-mix': 0.45,
    });
    // Sub Rumble: EQ + compressor for physical low end
    addDev(subRumbleTrack, 'builtin-eq', 'Rumble EQ', {
        'eq-low-gain': 4,
        'eq-low-freq': 40,
        'eq-low-q': 1,
        'eq-mid-gain': -6,
        'eq-mid-freq': 300,
        'eq-mid-q': 1.5,
        'eq-high-gain': 0,
        'eq-high-freq': 5000,
        'eq-high-q': 1,
    });
    addDev(subRumbleTrack, 'builtin-compressor', 'Rumble Comp', {
        'comp-threshold': -8,
        'comp-ratio': 8,
        'comp-attack': 5,
        'comp-release': 100,
        'comp-knee': 6,
        'comp-makeup': 1,
    });
    // Metallic Ring: massive reverb + delay for resonant tails
    addDev(metalRingTrack, 'builtin-reverb', 'Ring Verb', {
        'rev-size': 0.95,
        'rev-decay': 12,
        'rev-damping': 0.05,
        'rev-mix': 0.6,
    });
    addDev(metalRingTrack, 'builtin-delay', 'Ring Echo', {
        'delay-time': 500,
        'delay-feedback': 0.5,
        'delay-mix': 0.3,
    });
    // Ghost Snare: reverb for misty snare wash
    addDev(ghostSnareTrack, 'builtin-reverb', 'Ghost Verb', {
        'rev-size': 0.4,
        'rev-decay': 2,
        'rev-damping': 0.3,
        'rev-mix': 0.25,
    });
    // Harmonic Wash: chorus + massive reverb for ethereal bloom
    addDev(harmWashTrack, 'builtin-chorus', 'Wash Chorus', {
        'chorus-rate': 0.1,
        'chorus-depth': 15,
        'chorus-mix': 0.6,
    });
    addDev(harmWashTrack, 'builtin-reverb', 'Wash Verb', {
        'rev-size': 1.0,
        'rev-decay': 15,
        'rev-damping': 0.05,
        'rev-mix': 0.7,
    });

    // ── GAIN / PAN — stereo field (rebalanced for ambient clarity) ─────
    drumKitTrack.gain = 0.55;
    drumKitTrack.pan = 0;
    percShakerTrack.gain = 0.22;
    percShakerTrack.pan = 45;
    percHitsTrack.gain = 0.05;
    percHitsTrack.pan = 0;
    subBassTrack.gain = 0.2;
    subBassTrack.pan = 0;
    pianoTrack.gain = 0.62;
    pianoTrack.pan = -35;
    rhodesTrack.gain = 0.5;
    rhodesTrack.pan = 35;
    organTrack.gain = 0.35;
    organTrack.pan = -20;
    warmPadTrack.gain = 0.2;
    warmPadTrack.pan = 30;
    shimmerPadTrack.gain = 0.19;
    shimmerPadTrack.pan = -45;
    darkPadTrack.gain = 0.42;
    darkPadTrack.pan = 40;
    stringsSoftTrack.gain = 0.42;
    stringsSoftTrack.pan = -30;
    stringsBrightTrack.gain = 0.42;
    stringsBrightTrack.pan = 35;
    leadClassicTrack.gain = 0.6;
    leadClassicTrack.pan = 0;
    leadSoftTrack.gain = 0.45;
    leadSoftTrack.pan = 0;
    brassTrack.gain = 0.4;
    brassTrack.pan = 0;
    arpTrack.gain = 0.35;
    arpTrack.pan = 45;
    riserTrack.gain = 0.38;
    riserTrack.pan = 0;
    noiseSweepTrack.gain = 0.3;
    noiseSweepTrack.pan = 0;
    fluteTrack.gain = 0.15;
    fluteTrack.pan = -35;
    bellAccentTrack.gain = 0.025;
    bellAccentTrack.pan = 42;
    crystalTexTrack.gain = 0.18;
    crystalTexTrack.pan = -45;
    tremPulseTrack.gain = 0.28;
    tremPulseTrack.pan = 42;
    widePadTrack.gain = 0.42;
    widePadTrack.pan = 0;
    drumFillTrack.gain = 0.4;
    drumFillTrack.pan = 0;
    impactFxTrack.gain = 0.45;
    impactFxTrack.pan = 0;
    texChirpTrack.gain = 0.15;
    texChirpTrack.pan = -48;
    // Texture tracks — very low gain, wide stereo field
    pluckArpATrack.gain = 0.06;
    pluckArpATrack.pan = -40;
    pluckArpBTrack.gain = 0.05;
    pluckArpBTrack.pan = 40;
    rhodesStabATrack.gain = 0.05;
    rhodesStabATrack.pan = -35;
    rhodesStabBTrack.gain = 0.04;
    rhodesStabBTrack.pan = 38;
    bellScatterTrack.gain = 0.03;
    bellScatterTrack.pan = 48;
    glassSwellTrack.gain = 0.07;
    glassSwellTrack.pan = -28;
    malletTapTrack.gain = 0.05;
    malletTapTrack.pan = 30;
    pizzLayerTrack.gain = 0.06;
    pizzLayerTrack.pan = -45;
    chimeDropTrack.gain = 0.04;
    chimeDropTrack.pan = 0;
    microPercTrack.gain = 0.08;
    microPercTrack.pan = -48;
    // Deep Layers — subliminal gains, wide stereo field
    tapeHissTrack.gain = 0.03;
    tapeHissTrack.pan = 0;
    granStutterTrack.gain = 0.12;
    granStutterTrack.pan = -38;
    polyClickTrack.gain = 0.08;
    polyClickTrack.pan = 25;
    revSwellTrack.gain = 0.25;
    revSwellTrack.pan = 0;
    modSeqTrack.gain = 0.15;
    modSeqTrack.pan = -42;
    breathPadTrack.gain = 0.2;
    breathPadTrack.pan = 0;
    subRumbleTrack.gain = 0.35;
    subRumbleTrack.pan = 0;
    metalRingTrack.gain = 0.06;
    metalRingTrack.pan = 45;
    ghostSnareTrack.gain = 0.08;
    ghostSnareTrack.pan = -15;
    harmWashTrack.gain = 0.1;
    harmWashTrack.pan = -30;

    // ── AUDIO DRUM BUFFERS ────────────────────────────────────────────────
    const cx = Date.now();
    const bShaker = `d1-shaker-${cx}`,
        bPerc = `d1-perc-${cx}`,
        bNoise = `d1-noise-${cx}`;
    await Promise.all([
        generateDemoDrumBuffer(bShaker, TB, bpm, 'shaker'),
        generateDemoDrumBuffer(bPerc, TB, bpm, 'hat'),
        generateDemoDrumBuffer(bNoise, TB, bpm, 'shaker'),
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
    subBassTrack.clips = [subClip];

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

    const darkClip = createMidiClip(darkPadTrack.id, 'Dark Tension', 192, 512, darkPadTrack.color);
    darkPadTrack.clips = [darkClip];

    const strSoftClip = createMidiClip(stringsSoftTrack.id, 'Strings Soft', 64, TB, stringsSoftTrack.color);
    stringsSoftTrack.clips = [strSoftClip];

    const strBrightClip = createMidiClip(
        stringsBrightTrack.id,
        'Strings Catharsis',
        224,
        320,
        stringsBrightTrack.color
    );
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
    const fluteClip = createMidiClip(fluteTrack.id, 'Sine Counter', 128, 512, fluteTrack.color);
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

    // ── DEEP LAYERS CLIPS ──────────────────────────────────────────────
    // 1. Tape Hiss — full duration audio
    const tapeHissClip = createAudioClip(tapeHissTrack.id, 'Tape Hiss', 0, TB, bNoise, tapeHissTrack.color);
    tapeHissTrack.clips = [tapeHissClip];

    // 2. Granular Stutter — transition clips only
    const granClips: ReturnType<typeof createMidiClip>[] = [];
    for (const [s, e] of [
        [60, 68],
        [124, 132],
        [220, 228],
        [316, 324],
        [380, 388],
        [508, 516],
    ] as const) {
        const gc = createMidiClip(granStutterTrack.id, `Stutter ${s}`, s, e, granStutterTrack.color);
        granClips.push(gc);
    }
    granStutterTrack.clips = granClips;

    // 3. Polyrhythmic Click — 128-512
    const polyClickClip = createMidiClip(polyClickTrack.id, 'Poly Click', 128, 512, polyClickTrack.color);
    polyClickTrack.clips = [polyClickClip];

    // 4. Reversed Swell — clips leading into section boundaries
    const revSwellClips: ReturnType<typeof createMidiClip>[] = [];
    for (const [s, e] of [
        [16, 32],
        [48, 64],
        [96, 128],
        [192, 224],
        [352, 384],
    ] as const) {
        const rc = createMidiClip(revSwellTrack.id, `Swell ${s}`, s, e, revSwellTrack.color);
        revSwellClips.push(rc);
    }
    revSwellTrack.clips = revSwellClips;

    // 5. Modular Sequence — 224-320 (catharsis) + 384-512 (final rise), skip breakdown
    const modSeqClip1 = createMidiClip(modSeqTrack.id, 'Mod Catharsis', 224, 320, modSeqTrack.color);
    const modSeqClip2 = createMidiClip(modSeqTrack.id, 'Mod Rise', 384, 512, modSeqTrack.color);
    modSeqTrack.clips = [modSeqClip1, modSeqClip2];

    // 6. Breath Pad — 64-640
    const breathPadClip = createMidiClip(breathPadTrack.id, 'Breath Pad', 64, TB, breathPadTrack.color);
    breathPadTrack.clips = [breathPadClip];

    // 7. Sub Rumble — 224-320 + 384-512
    const subRumClip1 = createMidiClip(subRumbleTrack.id, 'Rumble Catharsis', 224, 320, subRumbleTrack.color);
    const subRumClip2 = createMidiClip(subRumbleTrack.id, 'Rumble Rise', 384, 512, subRumbleTrack.color);
    subRumbleTrack.clips = [subRumClip1, subRumClip2];

    // 8. Metallic Ring — 128-640
    const metalRingClip = createMidiClip(metalRingTrack.id, 'Metal Ring', 128, TB, metalRingTrack.color);
    metalRingTrack.clips = [metalRingClip];

    // 9. Ghost Snare — 128-512
    const ghostSnareClip = createMidiClip(ghostSnareTrack.id, 'Ghost Snare', 128, 512, ghostSnareTrack.color);
    ghostSnareTrack.clips = [ghostSnareClip];

    // 10. Harmonic Wash — 32-640
    const harmWashClip = createMidiClip(harmWashTrack.id, 'Harmonic Wash', 32, TB, harmWashTrack.color);
    harmWashTrack.clips = [harmWashClip];

    // 808 DRUM KIT NOTES — AMBIENT/MINIMAL style (Kiasmos inspired)
    // Sparse kicks in intro, hi-hat variety, 4-on-floor in final section
    const drumN: MidiNote[] = [];
    for (let b = 64; b < 576; b += 1) {
        if (b >= 320 && b < 384) {continue;} // breakdown silence
        const pos = b % 4;
        const bar = Math.floor(b / 4);
        const inBuild = b < 128;
        const inCatharsis = b >= 224 && b < 320;
        const inFinal = b >= 384 && b < 512; // dance section
        const inOutro = b >= 512;

        // === KICK ===
        if (inFinal) {
            // 4-on-the-floor dance pattern (every beat)
            drumN.push(note(36, b, 0.8, hv(90, 6)));
        } else if (inBuild && (pos === 0 || pos === 2)) {
            drumN.push(note(36, b, pos === 0 ? 1.0 : 0.8, hv(pos === 0 ? 65 : 50, 8)));
        } else if (inOutro && pos === 0 && bar % 2 === 0) {
            drumN.push(note(36, b, 1.0, hv(55, 8)));
        } else if (inCatharsis) {
            // 4-on-floor in catharsis
            drumN.push(note(36, b, 0.8, hv(pos === 0 ? 95 : 80, 6)));
        } else if (!inBuild && !inOutro) {
            if (pos === 0) {
                drumN.push(note(36, b, 1.0, hv(80, 6)));
            }
            if (pos === 2) {
                drumN.push(note(36, b, 0.8, hv(50, 8)));
            }
        }

        // === SNARE/RIMSHOT ===
        if (inFinal) {
            if (pos === 1 && bar % 2 === 1) {
                // Sparse offbeat snare texture
                drumN.push(note(38, b + 0.5, 0.3, hv(65, 8)));
            }
            if (pos === 3 && bar % 4 === 3) {
                // Occasional late 16th texture
                drumN.push(note(38, b + 0.75, 0.3, hv(55, 8)));
            }
        } else if (!inBuild && pos === 3 && bar % 2 === 1) {
            const snarePitch = inCatharsis ? 38 : 37;
            drumN.push(note(snarePitch, b, 0.3, hv(inCatharsis ? 87 : 55, 10)));
        }
        // Ghost snares at offset 1.5 on every bar in catharsis
        if (inCatharsis && pos === 0 && b % 4 === 0) {
            drumN.push(note(38, b + 1.5, 0.15, hv(30, 5)));
        }

        // === 16TH GHOST HATS (shimmering Kiasmos texture) ===
        if (!inOutro && !(b >= 320 && b < 384)) {
            drumN.push(note(42, b + 0.25, 0.05, hv(21, 4)));
            drumN.push(note(42, b + 0.75, 0.05, hv(21, 4)));
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
            // Offbeat hats for dance feel (specifically on upbeat 8th notes, never overlapping kick)
            drumN.push(note(42, b + 0.5, 0.15, hv(50, 10)));
            if (bar % 4 === 3 && pos === 3) {
                drumN.push(note(46, b + 0.75, 0.3, hv(45, 8))); // open hat fill
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
        const baseVel = b < 16 ? 35 : b < 32 ? 45 : b < 64 ? 58 : inBD ? 38 : b >= 512 ? 48 : 72;
        // Velocity swell: crescendo +5 per note within each 16-beat chord section
        const posInChord = Math.floor((b % 16) / 4); // 0-3 within chord section
        const vel = Math.min(127, baseVel + posInChord * 5);
        // Syncopation: every 4th repetition (every 16 beats), shift start by +0.5
        const repIndex = Math.floor(b / 4);
        const startShift = repIndex % 4 === 3 ? 0.5 : 0;
        subN.push(note(c.sub, b + startShift, 3.8 - startShift, hv(vel, 5)));
    }

    // PULSE BASS — syncopated 8th-note pattern (+12 octave to separate from sub)
    const pulseN: MidiNote[] = [];
    const pulseOffsets = [0, 0.5, 1.5, 2, 3, 3.5];
    const pulseDenseOffsets = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]; // 16ths
    for (let bar = 8; bar < TB / 4; bar++) {
        const b = bar * 4;
        if (b >= 320 && b < 384) {continue;}
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
    // Intro: arpeggiated chord tones every 4 beats (root, third, fifth staggered by 0.1)
    for (let b = 2; b < 64; b += 4) {
        const c = ch(b);
        const vel = b < 16 ? 40 : 50;
        pianoN.push(note(c.root + 24, b, 1.5, hv(vel, 8)));
        pianoN.push(note(c.third + 24, b + 0.1, 1.5, hv(vel - 4, 8)));
        pianoN.push(note(c.fifth + 24, b + 0.2, 1.5, hv(vel - 8, 10)));
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

    // RHODES — warm chords in groove sections (8-beat intervals with ninth)
    const rhodesN: MidiNote[] = [];
    for (let b = 64; b < 512; b += 8) {
        if (b >= 320 && b < 384) {continue;}
        const c = ch(b);
        const vel = b < 128 ? 52 : b >= 224 ? 65 : 58;
        rhodesN.push(note(c.root + 12, b + 0.05, 7.5, hv(vel, 6)));
        rhodesN.push(note(c.third + 12, b + 0.08, 7.5, hv(vel - 4, 6)));
        rhodesN.push(note(c.fifth + 12, b + 0.12, 7.5, hv(vel - 8, 8)));
        rhodesN.push(note(c.seventh + 12, b + 0.15, 7.5, hv(vel - 12, 8)));
        rhodesN.push(note(c.ninth + 12, b + 0.18, 7.5, hv(vel - 16, 8)));
    }

    // ORGAN — sustained texture in mid-sections (staggered starts for natural feel)
    const organN: MidiNote[] = [];
    for (let b = 128; b < 320; b += 32) {
        const c = ch(b);
        organN.push(note(c.root + 12, b, 31, hv(42, 6)));
        organN.push(note(c.third + 12, b + 0.05, 31, hv(40, 6)));
        organN.push(note(c.fifth + 12, b + 0.1, 31, hv(38, 6)));
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
        if (b >= 320 && b < 384) {continue;}
        const c = ch(b);
        const vel = b >= 224 && b < 320 ? 65 : 50;
        shimmerN.push(note(c.root + 12, b, 15.8, hv(vel - 10, 10)));
        shimmerN.push(note(c.third + 12, b, 15.8, hv(vel - 12, 10)));
        shimmerN.push(note(c.ninth + 12, b, 15.8, hv(vel, 10)));
        shimmerN.push(note(c.root + 24, b, 15.8, hv(vel - 15, 10)));
    }

    // DARK PAD — tension builder before catharsis & final rise
    const darkN: MidiNote[] = [];
    for (let b = 192; b < 384; b += 8) {
        const c = ch(b);
        const vel = b < 224 ? 35 + Math.floor((b - 192) * 1.5) : b >= 320 ? 45 : 55;
        darkN.push(note(c.root, b, 7.5, hv(vel, 8)));
        darkN.push(note(c.fifth, b, 7.5, hv(vel - 10, 8)));
    }
    // Dark pad in final rise (384-512) with escalating velocity
    for (let b = 384; b < 512; b += 8) {
        const c = ch(b);
        const vel = 40 + Math.floor((b - 384) * 0.2);
        darkN.push(note(c.root, b, 7.5, hv(vel, 8)));
        darkN.push(note(c.fifth, b, 7.5, hv(vel - 10, 8)));
    }

    // STRINGS SOFT — counter-voice, enters at build
    const strSoftN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 16) {
        if (b >= 320 && b < 384) {continue;}
        if (b >= 576) {continue;}
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
    const leadMotifA = [
        [0, 62, 2.0, 92],
        [2, 65, 1.0, 80],
        [3, 67, 0.5, 75],
        [3.5, 69, 1.5, 88],
        [5, 67, 1.0, 70],
        [6, 65, 2.0, 82],
        [8, 72, 3.0, 95],
        [11, 69, 1.0, 78],
        [12, 67, 0.5, 72],
        [12.5, 65, 3.5, 85],
    ] as const;
    // Motif B: swap notes 3 and 5, add +2 to notes 7-8
    const leadMotifB = [
        [0, 62, 2.0, 92],
        [2, 65, 1.0, 80],
        [3, 67, 1.0, 70],
        [3.5, 69, 0.5, 75],
        [5, 69, 1.5, 88],
        [6, 65, 2.0, 82],
        [8, 74, 3.0, 97],
        [11, 71, 1.0, 80],
        [12, 67, 0.5, 72],
        [12.5, 65, 3.5, 85],
    ] as const;
    const leadN: MidiNote[] = [];
    // First appearance: groove entry (beat 160) — A/B alternation
    for (let phrase = 0; phrase < 4; phrase++) {
        const base = 160 + phrase * 16;
        const motif = phrase % 2 === 0 ? leadMotifA : leadMotifB;
        for (const [off, pitch, dur, vel] of motif) {
            leadN.push(note(pitch, base + off, dur, hv(vel, 8)));
        }
    }
    // Catharsis: full lead + higher register — A/B alternation
    for (let phrase = 0; phrase < 6; phrase++) {
        const base = 224 + phrase * 16;
        const shift = phrase >= 4 ? 12 : 0;
        const motif = phrase % 2 === 0 ? leadMotifA : leadMotifB;
        for (const [off, pitch, dur, vel] of motif) {
            leadN.push(note(pitch + shift, base + off, dur, hv(vel + 5, 8)));
        }
    }
    // Final rise: octave up — A/B alternation
    for (let phrase = 0; phrase < 4; phrase++) {
        const base = 416 + phrase * 16;
        const motif = phrase % 2 === 0 ? leadMotifA : leadMotifB;
        for (const [off, pitch, dur, vel] of motif) {
            leadN.push(note(pitch + 12, base + off, dur, hv(vel, 10)));
        }
    }

    // LEAD SOFT — answer phrase, fills between classic lead
    const leadSoftN: MidiNote[] = [];
    const answerMotif = [
        [0, 69, 1.5, 68],
        [2, 72, 2.0, 75],
        [4, 74, 1.0, 65],
        [5, 72, 1.5, 70],
        [7, 69, 2.5, 60],
    ] as const;
    for (let b = 232; b < 512; b += 32) {
        if (b >= 320 && b < 384) {continue;}
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
        [62, 65, 69, 72, 74],
        [67, 70, 74, 77],
        [69, 72, 76, 79],
        [70, 74, 77, 81],
    ];
    const ARP_STEPS = [0, 2, 1, 3, 2, 4, 3, 1];
    const arpN: MidiNote[] = [];
    let arpStep = 0;
    for (let b = 64; b < TB; b += 0.5) {
        // 8th notes, not 16ths
        if (b >= 320 && b < 384) {continue;}
        if (b >= 576) {continue;}
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
    for (let b = 196; b < 224; b += 2) {noiseN.push(note(60, b, 1.8, hv(30 + (b - 196) * 2, 5)));}
    for (let b = 356; b < 384; b += 2) {noiseN.push(note(60, b, 1.8, hv(30 + (b - 356) * 2, 5)));}

    // FLUTE COUNTER — lyrical Dm phrases that answer the lead
    const fluteN: MidiNote[] = [];
    const fluteA: [number, number, number, number][] = [
        [0, 74, 1.5, 72],
        [2, 72, 1, 68],
        [3, 69, 0.75, 70],
        [4, 67, 2, 65],
        [6, 69, 1, 62],
        [7, 72, 1, 68],
    ];
    const fluteB: [number, number, number, number][] = [
        [0, 77, 2, 70],
        [2.5, 74, 0.5, 65],
        [3, 72, 1.5, 68],
        [5, 69, 1, 65],
        [6.5, 67, 1.5, 60],
    ];
    const fluteC: [number, number, number, number][] = [
        [0, 67, 1.5, 72],
        [2, 69, 1.0, 70],
        [3, 72, 2.0, 80],
        [5, 67, 0.5, 65],
    ];
    for (let ph = 0; ph < (512 - 128) / 8; ph++) {
        const start = 128 + ph * 8;
        if (start >= 320 && start < 384) {continue;}
        const mel = ph % 3 === 0 ? fluteA : ph % 3 === 1 ? fluteB : fluteC;
        for (const [off, pitch, dur, vel] of mel) {fluteN.push(note(pitch, start + off, dur, hv(vel)));}
    }

    // BELL ACCENTS — bell tones every 8 beats (-12 octave to sit in mid range)
    const bellAccN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 8) {
        if (b >= 320 && b < 384) {continue;}
        const c = ch(b);
        const inOutro = b >= 512;
        bellAccN.push(note(c.ninth + 24, b + 2, 3, hv(inOutro ? 30 : 42)));
        if (b % 32 === 0 && b >= 128) {bellAccN.push(note(c.root + 36, b + 4, 4, hv(35)));}
    }

    // CRYSTAL TEXTURE — delicate 16th arps in intense sections (accent every 4th note)
    const crystalN: MidiNote[] = [];
    const crystalPool = [
        [62, 65, 69, 72],
        [67, 70, 74, 77],
        [69, 72, 76, 79],
        [70, 74, 77, 81],
    ];
    let cStep = 0;
    for (let b = 192; b < 512; b += 0.5) {
        if (b >= 320 && b < 384) {continue;}
        const ci = Math.floor(b / 16) % 4;
        const pool = crystalPool[ci]!;
        const pitch = pool[cStep % pool.length]! + 12;
        const baseVel = b >= 224 && b < 320 ? 48 : b >= 384 ? 42 : 35;
        const vel = cStep % 4 === 0 ? baseVel + 15 : baseVel;
        crystalN.push(note(pitch, b, 0.4, hv(vel)));
        cStep++;
    }

    // TREMOLO PULSE — rhythmic chord pulses with tremolo effect
    const tremN: MidiNote[] = [];
    for (let b = 128; b < 384; b += 4) {
        if (b >= 320 && b < 384) {continue;}
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
        if (!inBD) {wideN.push(note(c.ninth + 12, b, 31, hv(vel - 10)));}
    }

    // DRUM FILLS — minimal tom accents at section boundaries (not busy 16th fills)
    const drumFillN: MidiNote[] = [];
    const fillBeats = [112, 192, 288, 368, 448, 544];
    for (const fb of fillBeats) {
        if (fb >= 576) {break;}
        if (fb >= 320 && fb < 384) {continue;}
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
        if (b >= 320 && b < 384) {continue;}
        if (Math.random() < 0.3) {
            const pitch = chirpPitches[Math.floor(Math.random() * chirpPitches.length)]!;
            chirpN.push(note(pitch, b + Math.random() * 0.5, 0.05, hv(30, 5)));
        }
    }

    // ── DEEP LAYERS MIDI NOTES ─────────────────────────────────────────

    // 2. GRANULAR STUTTER — rapid 32nd-note repeated root tones at transitions
    const granNoteArrays: MidiNote[][] = [];
    for (const [s, e] of [
        [60, 68],
        [124, 132],
        [220, 228],
        [316, 324],
        [380, 388],
        [508, 516],
    ] as const) {
        const notes: MidiNote[] = [];
        for (let b = s; b < e; b += 0.125) {
            const c = ch(b);
            notes.push(note(c.root, b - s, 0.1, hv(50, 10)));
        }
        granNoteArrays.push(notes);
    }

    // 3. POLYRHYTHMIC CLICK — 3-against-4 polyrhythm (every 1.333 beats)
    const polyClickN: MidiNote[] = [];
    for (let b = 128; b < 512; b += 4 / 3) {
        if (b >= 320 && b < 384) {continue;}
        const c = ch(b);
        polyClickN.push(note(c.ninth, b - 128, 0.15, hv(42, 8)));
    }

    // 4. REVERSED SWELL — ascending chord tones with crescendo into section boundaries
    const revSwellNoteArrays: MidiNote[][] = [];
    for (const [s, e] of [
        [16, 32],
        [48, 64],
        [96, 128],
        [192, 224],
        [352, 384],
    ] as const) {
        const notes: MidiNote[] = [];
        const dur = e - s;
        const c = ch(s);
        const tones = [c.root + 12, c.third + 12, c.fifth + 12, c.seventh + 12];
        for (let i = 0; i < tones.length; i++) {
            const startBeat = i * (dur / tones.length);
            const velBase = 20 + Math.round((70 / tones.length) * i);
            notes.push(note(tones[i]!, startBeat, dur >= 32 ? 15 : 12, hv(velBase, 6)));
        }
        revSwellNoteArrays.push(notes);
    }

    // 5. MODULAR SEQUENCE — 16th-note stepped sequence, root/fifth alternation, accent every 3rd
    const modSeqN: MidiNote[] = [];
    let modAccent = 0;
    for (let b = 224; b < 320; b += 0.25) {
        const c = ch(b);
        const pitch = modAccent % 2 === 0 ? c.root : c.fifth;
        const vel = modAccent % 3 === 0 ? 72 : 45;
        modSeqN.push(note(pitch, b, 0.2, hv(vel, 6)));
        modAccent++;
    }
    for (let b = 384; b < 512; b += 0.25) {
        const c = ch(b);
        const pitch = modAccent % 2 === 0 ? c.root : c.fifth;
        const vel = modAccent % 3 === 0 ? 72 : 45;
        modSeqN.push(note(pitch, b, 0.2, hv(vel, 6)));
        modAccent++;
    }

    // 6. BREATH PAD — sustained root + third + fifth + seventh, new chord every 32 beats
    const breathPadN: MidiNote[] = [];
    for (let b = 64; b < TB; b += 32) {
        const c = ch(b);
        breathPadN.push(note(c.root + 12, b - 64, 31, hv(52, 8)));
        breathPadN.push(note(c.third + 12, b - 64, 31, hv(50, 8)));
        breathPadN.push(note(c.fifth + 12, b - 64, 31, hv(48, 8)));
        breathPadN.push(note(c.seventh + 12, b - 64, 31, hv(46, 8)));
    }

    // 7. SUB RUMBLE — D1 (pitch 26), one per 8 beats, 7.5 beat duration
    const subRumN: MidiNote[] = [];
    for (let b = 224; b < 320; b += 8) {
        subRumN.push(note(26, b, 7.5, hv(58, 8)));
    }
    for (let b = 384; b < 512; b += 8) {
        subRumN.push(note(26, b, 7.5, hv(58, 8)));
    }

    // 8. METALLIC RING — one hit per 16 beats, high register, very short
    const metalRingN: MidiNote[] = [];
    for (let b = 128; b < TB; b += 16) {
        if (b >= 320 && b < 384) {continue;}
        const c = ch(b);
        metalRingN.push(note(c.ninth + 24, b - 128, 0.1, hv(38, 8)));
    }

    // 9. GHOST SNARE — offbeat 16th ghost snare hits (pitch 38)
    const ghostSnareN: MidiNote[] = [];
    for (let b = 128; b < 512; b += 0.25) {
        if (b >= 320 && b < 384) {continue;}
        const pos = b % 1;
        if (pos === 0.25 || pos === 0.75) {
            ghostSnareN.push(note(38, b - 128, 0.1, hv(36, 6)));
        }
    }

    // 10. HARMONIC WASH — every 16 beats, chord root + fifth + seventh + ninth + 12
    const harmWashN: MidiNote[] = [];
    for (let b = 32; b < TB; b += 16) {
        const c = ch(b);
        harmWashN.push(note(c.root + 12, b - 32, 15, hv(30, 8)));
        harmWashN.push(note(c.fifth + 12, b - 32, 15, hv(28, 8)));
        harmWashN.push(note(c.seventh + 12, b - 32, 15, hv(32, 8)));
        harmWashN.push(note(c.ninth + 12, b - 32, 15, hv(28, 8)));
    }

    // ── TRACK ASSEMBLY ────────────────────────────────────────────────────
    const tracks = [
        masterTrack,
        drumFolder,
        drumKitTrack,
        percShakerTrack,
        percHitsTrack,
        bassFolder,
        subBassTrack,
        keysFolder,
        pianoTrack,
        rhodesTrack,
        organTrack,
        strPadFolder,
        warmPadTrack,
        shimmerPadTrack,
        darkPadTrack,
        stringsSoftTrack,
        stringsBrightTrack,
        leadsFolder,
        leadClassicTrack,
        leadSoftTrack,
        brassTrack,
        arpTrack,
        flourishFolder,
        fluteTrack,
        bellAccentTrack,
        crystalTexTrack,
        tremPulseTrack,
        widePadTrack,
        drumFillTrack,
        impactFxTrack,
        texChirpTrack,
        fxFolder,
        riserTrack,
        noiseSweepTrack,
        reverbBusTrack,
        deepFolder,
        tapeHissTrack,
        granStutterTrack,
        polyClickTrack,
        revSwellTrack,
        modSeqTrack,
        breathPadTrack,
        subRumbleTrack,
        metalRingTrack,
        ghostSnareTrack,
        harmWashTrack,
    ];
    trackStore.set({ tracks, selectedTrackId: warmPadTrack.id });

    midiStore.set({
        notesByClipId: {
            [dk1.id]: drumN
                .filter((n) => n.startBeat >= 64 && n.startBeat < 128)
                .map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [dk2.id]: drumN
                .filter((n) => n.startBeat >= 128 && n.startBeat < 224)
                .map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            [dk3.id]: drumN
                .filter((n) => n.startBeat >= 224 && n.startBeat < 320)
                .map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [dk4.id]: drumN
                .filter((n) => n.startBeat >= 384 && n.startBeat < 512)
                .map((n) => ({ ...n, startBeat: n.startBeat - 384 })),
            [dk5.id]: drumN
                .filter((n) => n.startBeat >= 512 && n.startBeat < 576)
                .map((n) => ({ ...n, startBeat: n.startBeat - 512 })),
            [subClip.id]: subN,
            [pianoIntro.id]: pianoN.filter((n) => n.startBeat < 64),
            [pianoBD.id]: pianoN
                .filter((n) => n.startBeat >= 320 && n.startBeat < 384)
                .map((n) => ({ ...n, startBeat: n.startBeat - 320 })),
            [pianoOutro.id]: pianoN
                .filter((n) => n.startBeat >= 512)
                .map((n) => ({ ...n, startBeat: n.startBeat - 512 })),
            [rhodesClip.id]: rhodesN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [organClip.id]: organN.map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            [warmPadClip.id]: warmPadN,
            [shimmerClip.id]: shimmerN.map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            [darkClip.id]: darkN.map((n) => ({ ...n, startBeat: n.startBeat - 192 })),
            [strSoftClip.id]: strSoftN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [strBrightClip.id]: strBrightN.map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [leadClip.id]: leadN.map((n) => ({ ...n, startBeat: n.startBeat - 160 })),
            [leadSoftClip.id]: leadSoftN.map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [brassClip.id]: brassN.map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [arpClip.id]: arpN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [riserClip1.id]: riserN
                .filter((n) => n.startBeat < 224)
                .map((n) => ({ ...n, startBeat: n.startBeat - 192 })),
            [riserClip2.id]: riserN
                .filter((n) => n.startBeat >= 352)
                .map((n) => ({ ...n, startBeat: n.startBeat - 352 })),
            [noiseClip1.id]: noiseN
                .filter((n) => n.startBeat < 224)
                .map((n) => ({ ...n, startBeat: n.startBeat - 192 })),
            [noiseClip2.id]: noiseN
                .filter((n) => n.startBeat >= 352)
                .map((n) => ({ ...n, startBeat: n.startBeat - 352 })),
            [fluteClip.id]: fluteN.map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            [bellAccClip.id]: bellAccN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [crystalClip.id]: crystalN.map((n) => ({ ...n, startBeat: n.startBeat - 192 })),
            [tremPulseClip.id]: tremN.map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            [widePadClip.id]: wideN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [drumFillClip.id]: drumFillN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [impactClip.id]: impactN.map((n) => ({ ...n, startBeat: n.startBeat - 64 })),
            [chirpClip.id]: chirpN.map((n) => ({ ...n, startBeat: n.startBeat - 128 })),
            // Deep Layers MIDI notes
            ...Object.fromEntries(granClips.map((gc, i) => [gc.id, granNoteArrays[i]!])),
            [polyClickClip.id]: polyClickN,
            ...Object.fromEntries(revSwellClips.map((rc, i) => [rc.id, revSwellNoteArrays[i]!])),
            [modSeqClip1.id]: modSeqN
                .filter((n) => n.startBeat >= 224 && n.startBeat < 320)
                .map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [modSeqClip2.id]: modSeqN
                .filter((n) => n.startBeat >= 384)
                .map((n) => ({ ...n, startBeat: n.startBeat - 384 })),
            [breathPadClip.id]: breathPadN,
            [subRumClip1.id]: subRumN
                .filter((n) => n.startBeat >= 224 && n.startBeat < 320)
                .map((n) => ({ ...n, startBeat: n.startBeat - 224 })),
            [subRumClip2.id]: subRumN
                .filter((n) => n.startBeat >= 384)
                .map((n) => ({ ...n, startBeat: n.startBeat - 384 })),
            [metalRingClip.id]: metalRingN,
            [ghostSnareClip.id]: ghostSnareN,
            [harmWashClip.id]: harmWashN,
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
        { beat: 312, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 318, value: 0.2, curve: 'linear', tension: 0 },
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
        { beat: 384, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 448, value: 0.55, curve: 'linear', tension: 0 },
        { beat: 512, value: 0, curve: 'linear', tension: 0 },
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
        if (b >= 320 && b < 384) {continue;} // skip breakdown
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
    pluckArpAClip.notes = arpAN;
    pluckArpBClip.notes = arpBN;
    rhodesStabAClip.notes = rStabAN;
    rhodesStabBClip.notes = rStabBN;
    bellScatterClip.notes = bScatN;
    glassSwellClip.notes = gSwellN;
    malletTapClip.notes = malTapN;
    pizzLayerClip.notes = pizzN;
    chimeDropClip.notes = chimeN;
    microPercClip.notes = microN;

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
        { beat: 224, value: 0.1, curve: 'linear', tension: 0 },
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
        { beat: 160, value: 0.12, curve: 'linear', tension: 0 }, // Smooth intermediate
        { beat: 200, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.45, curve: 'linear', tension: 0 }, // WOW: reverb swells into catharsis
        { beat: 272, value: 0.5, curve: 'linear', tension: 0 }, // Smooth catharsis rise
        { beat: 288, value: 0.6, curve: 'linear', tension: 0 }, // Peak reverb wash
        { beat: 320, value: 0.08, curve: 'linear', tension: 0 }, // SNAP: dry at breakdown
        { beat: 384, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.55, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.7, curve: 'linear', tension: 0 }, // Outro: dissolves into reverb
    ];

    // Arp delay feedback: builds to near-self-oscillation then CUT
    const arpDelayFb = mkLane(arpTrack.id, 'delay-feedback', 'Delay FB', 0, 0.95);
    arpDelayFb.points = [
        { beat: 64, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 200, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 216, value: 0.5, curve: 'linear', tension: 0 }, // Start 16-beat ramp
        { beat: 220, value: 0.62, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.72, curve: 'linear', tension: 0 },
        { beat: 228, value: 0.82, curve: 'linear', tension: 0 },
        { beat: 232, value: 0.85, curve: 'linear', tension: 0 }, // WOW: near self-oscillation!
        { beat: 310, value: 0.88, curve: 'linear', tension: 0 }, // Held at edge
        { beat: 320, value: 0.1, curve: 'linear', tension: 0 }, // SNAP: cut to almost nothing
        { beat: 400, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 576, value: 0.2, curve: 'linear', tension: 0 },
    ];

    // Lead reverb mix: massive contrast — dry intimate vs huge space
    const leadRevMix = mkLane(leadClassicTrack.id, 'rev-mix', 'Reverb Mix', 0, 1);
    leadRevMix.points = [
        { beat: 160, value: 0.08, curve: 'linear', tension: 0 }, // Starts dry/intimate
        { beat: 180, value: 0.18, curve: 'linear', tension: 0 }, // Smoother entry into catharsis
        { beat: 192, value: 0.12, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.45, curve: 'linear', tension: 0 }, // WOW: huge reverb at catharsis
        { beat: 288, value: 0.55, curve: 'linear', tension: 0 }, // Peak space
        { beat: 320, value: 0.05, curve: 'linear', tension: 0 }, // SNAP: completely dry
        { beat: 416, value: 0.2, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.6, curve: 'linear', tension: 0 }, // Dissolves
    ];

    // Dark pad distortion drive: ramps up into catharsis (sinister growl)
    const darkDrive = mkLane(darkPadTrack.id, 'dist-drive', 'Drive', 0.1, 20);
    darkDrive.points = [
        { beat: 192, value: 1, curve: 'linear', tension: 0 },
        { beat: 220, value: 3, curve: 'linear', tension: 0 },
        { beat: 224, value: 8, curve: 'linear', tension: 0 }, // WOW: distortion kicks in hard
        { beat: 280, value: 12, curve: 'linear', tension: 0 }, // Peak grit
        { beat: 320, value: 1, curve: 'linear', tension: 0 }, // Clean at breakdown
        { beat: 384, value: 2, curve: 'linear', tension: 0 },
    ];

    // Extreme Automations (Jon Hopkins / Kiasmos style)
    const widePadMix = mkLane(widePadTrack.id, 'chorus-mix', 'Chorus Wash', 0, 1);
    widePadMix.points = [
        { beat: 0, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.95, curve: 'linear', tension: 0 }, // Total wash
        { beat: 320, value: 0.05, curve: 'linear', tension: 0 },
    ];

    const shimmerDepth = mkLane(shimmerPadTrack.id, 'rev-damping', 'Shimmer Open', 0, 1);
    shimmerDepth.points = [
        { beat: 64, value: 0.8, curve: 'linear', tension: 0 }, // Muffled
        { beat: 224, value: 0.1, curve: 'linear', tension: 0 }, // Bright/open
        { beat: 320, value: 0.9, curve: 'linear', tension: 0 },
    ];

    // Delay mix on crystal texture: scattered → dense → gone
    const crystalDelayMix = mkLane(crystalTexTrack.id, 'delay-mix', 'Delay Mix', 0, 1);
    crystalDelayMix.points = [
        { beat: 192, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.5, curve: 'linear', tension: 0 }, // WOW: dense cascading delays
        { beat: 288, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.0, curve: 'linear', tension: 0 }, // CUT
        { beat: 400, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.0, curve: 'linear', tension: 0 },
    ];

    const leadClassicPan = mkLane(leadClassicTrack.id, 'pan', 'Pan', 0, 1);
    leadClassicPan.points = [
        { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.1, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.9, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
    ];

    const leadSoftPan = mkLane(leadSoftTrack.id, 'pan', 'Pan', 0, 1);
    leadSoftPan.points = [
        { beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 256, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.9, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.1, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.5, curve: 'linear', tension: 0 },
    ];

    // ── DEEP LAYERS AUTOMATION ────────────────────────────────────────
    // Tape Hiss volume: fade in from intro, present throughout, swell at catharsis
    const tapeHissVol = mkLane(tapeHissTrack.id, 'volume', 'Volume', 0, 1);
    tapeHissVol.points = [
        { beat: 0, value: 0, curve: 'linear', tension: 0 },
        { beat: 32, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.65, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.85, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.5, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.55, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.2, curve: 'linear', tension: 0 },
    ];

    // Modular Sequence filter cutoff sweep
    const modFilterCutoff = mkLane(modSeqTrack.id, 'filter-cutoff', 'Filter Cutoff', 20, 20000);
    modFilterCutoff.points = [
        { beat: 224, value: 500, curve: 'linear', tension: 0 },
        { beat: 272, value: 8000, curve: 'linear', tension: 0 },
        { beat: 320, value: 500, curve: 'linear', tension: 0 },
        { beat: 384, value: 1000, curve: 'linear', tension: 0 },
        { beat: 448, value: 6000, curve: 'linear', tension: 0 },
        { beat: 512, value: 800, curve: 'linear', tension: 0 },
    ];

    // Breath Pad tremolo depth: follows song energy
    const breathTremDepth = mkLane(breathPadTrack.id, 'trem-depth', 'Trem Depth', 0, 1);
    breathTremDepth.points = [
        { beat: 64, value: 0.3, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.45, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.35, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.6, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.4, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.3, curve: 'linear', tension: 0 },
    ];

    // Harmonic Wash volume: barely there, swells at catharsis, dissolves
    const harmWashVol = mkLane(harmWashTrack.id, 'volume', 'Volume', 0, 1);
    harmWashVol.points = [
        { beat: 32, value: 0.05, curve: 'linear', tension: 0 },
        { beat: 64, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 128, value: 0.25, curve: 'linear', tension: 0 },
        { beat: 224, value: 0.7, curve: 'linear', tension: 0 },
        { beat: 320, value: 0.15, curve: 'linear', tension: 0 },
        { beat: 384, value: 0.4, curve: 'linear', tension: 0 },
        { beat: 512, value: 0.25, curve: 'linear', tension: 0 },
        { beat: TB, value: 0.02, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [
            subVol,
            warmVol,
            drumVol,
            strSoftVol,
            arpVol,
            leadVol,
            pianoVol,
            brassVol,
            darkVol,
            rhodesVol,
            shimmerVol,
            leadSoftVol,
            strBrightVol,
            fluteVol,
            crystalVol,
            wideVol,
            tremVol,
            bellAccVol,
            // Dramatic effect automation
            warmRevMix,
            arpDelayFb,
            leadRevMix,
            darkDrive,
            crystalDelayMix,
            widePadMix,
            shimmerDepth,
            // Pan automation
            leadClassicPan,
            leadSoftPan,
            // Deep Layers automation
            tapeHissVol,
            modFilterCutoff,
            breathTremDepth,
            harmWashVol,
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
            {
                id: crypto.randomUUID(),
                startBeat: 384,
                endBeat: 512,
                name: 'Final Rise',
                color: 'oklch(0.40 0.08 150)',
            },
            { id: crypto.randomUUID(), startBeat: 512, endBeat: TB, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
        ],
    });

    syncArrangement(tracks);

    // Bootstrap device audio nodes from store state
    const { ensureTrackStrips } = await import('#/modules/Transport/useCases');
    ensureTrackStrips();

    // Await all internal async device creations (e.g. Faust WASM compilation)
    const { waitForDevices } = await import('#/modules/AudioEngine/useCases');
    await waitForDevices();

    projectStore.set({
        name: 'Resonance (Demo)',
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
