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
        duration: duration,
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
// Demo Project 1: The Complete Mix (10+ Tracks)
// ---------------------------------------------------------------------------

export async function demo1_TheCompleteMix(): Promise<void> {
    const bpm = 125;
    const totalBeats = 128; // ~61 seconds at 125 BPM

    const masterTrack = createTrack({ name: 'Master', kind: 'master' });
    
    // Audio Tracks
    const kickTrack = createTrack({ name: 'Kick', kind: 'audio' });
    const snareTrack = createTrack({ name: 'Snare', kind: 'audio' });
    const hatTrack = createTrack({ name: 'Hi-Hats', kind: 'audio' });
    const percTrack = createTrack({ name: 'Percussion', kind: 'audio' });
    const voxTrack = createTrack({ name: 'Vocal Atmos', kind: 'audio' });

    // MIDI Tracks
    const subBassTrack = createTrack({ name: 'Sub Bass', kind: 'midi' });
    const midBassTrack = createTrack({ name: 'Analog Bass', kind: 'midi' });
    const padTrack = createTrack({ name: 'Warm Pad', kind: 'midi' });
    const pluckTrack = createTrack({ name: 'Arp Pluck', kind: 'midi' });
    const leadTrack = createTrack({ name: 'Classic Lead', kind: 'midi' });

    // Apply Factory Presets
    applyPreset(subBassTrack, 'factory-bass-sub');
    applyPreset(midBassTrack, 'factory-bass-analog');
    applyPreset(padTrack, 'factory-pad-warm');
    applyPreset(pluckTrack, 'factory-keys-pluck');
    applyPreset(leadTrack, 'factory-lead-classic');

    // Pan some tracks
    hatTrack.pan = 0.2;
    percTrack.pan = -0.3;
    pluckTrack.pan = -0.15;
    padTrack.pan = 0.1;

    // Generate Audio Buffers
    const ctxId = Date.now();
    const bufKick = `d1-kick-${ctxId}`;
    const bufSnare = `d1-snare-${ctxId}`;
    const bufHat = `d1-hat-${ctxId}`;
    const bufPerc = `d1-perc-${ctxId}`;
    const bufVox = `d1-vox-${ctxId}`;

    // Parallel buffer generation
    await Promise.all([
        generateDemoDrumBuffer(bufKick, totalBeats, bpm, 'kick'),
        generateDemoDrumBuffer(bufSnare, totalBeats, bpm, 'snare'),
        generateDemoDrumBuffer(bufHat, totalBeats, bpm, 'hat'),
        generateDemoDrumBuffer(bufPerc, totalBeats, bpm, 'shaker'),
        generateSyntheticToneBuffer(bufVox, totalBeats, bpm, 440) // A4 tone for vocals
    ]);

    // Create Clips
    const kickClip = createAudioClip(kickTrack.id, 'Kick Loop', 0, totalBeats, bufKick);
    const snareClip = createAudioClip(snareTrack.id, 'Snare Loop', 0, totalBeats, bufSnare);
    const hatClip = createAudioClip(hatTrack.id, 'Hat Loop', 0, totalBeats, bufHat);
    const percClip = createAudioClip(percTrack.id, 'Shaker Loop', 0, totalBeats, bufPerc);
    
    const voxClip = createAudioClip(voxTrack.id, 'Vocal Swell', 64, 128, bufVox); // Enters later
    voxClip.fadeInBeats = 16;
    voxClip.fadeOutBeats = 16;
    voxClip.gain = 0.3;

    const subClip = createMidiClip(subBassTrack.id, 'Sub Seq', 0, totalBeats);
    const midBassClip = createMidiClip(midBassTrack.id, 'Analog Seq', 0, totalBeats);
    const padClip = createMidiClip(padTrack.id, 'Chords', 0, totalBeats);
    const pluckClip = createMidiClip(pluckTrack.id, 'Arpeggio', 32, totalBeats); // Enters at beat 32
    const leadClip = createMidiClip(leadTrack.id, 'Main Melody', 64, totalBeats); // Enters at beat 64

    kickTrack.clips = [kickClip];
    snareTrack.clips = [snareClip];
    hatTrack.clips = [hatClip];
    percTrack.clips = [percClip];
    voxTrack.clips = [voxClip];

    subBassTrack.clips = [subClip];
    midBassTrack.clips = [midBassClip];
    padTrack.clips = [padClip];
    pluckTrack.clips = [pluckClip];
    leadTrack.clips = [leadClip];

    // Build MIDI sequences
    const subNotes: MidiNote[] = [];
    const midBassNotes: MidiNote[] = [];
    const padNotes: MidiNote[] = [];
    const pluckNotes: MidiNote[] = [];
    const leadNotes: MidiNote[] = [];

    // 128 beat progression (8 bars of 16 beats)
    for (let beat = 0; beat < totalBeats; beat++) {
        // Chord progression: Am (A, C, E), F (F, A, C), C (C, E, G), G (G, B, D)
        const bar = Math.floor(beat / 16);
        const chordIdx = bar % 4;
        
        let root = 45; // A2
        if (chordIdx === 1) root = 41; // F2
        if (chordIdx === 2) root = 48; // C3
        if (chordIdx === 3) root = 43; // G2

        // Intro (0-32), Verse (32-64), Chorus (64-96), Outro (96-128)

        // Sub Bass (1 note per measure, always active)
        if (beat % 4 === 0) {
            subNotes.push(note(root - 12, beat, 3.5, 90));
        }

        // Mid Bass (syncopated rhythm)
        if (beat % 2 === 0) {
            midBassNotes.push(note(root, beat, 0.5, 100)); // on beat
        } else if (beat % 4 === 1.5) {
            midBassNotes.push(note(root + 12, beat, 0.25, 80)); // syncopated high octave
        }

        // Pad (long chords)
        if (beat % 16 === 0) {
            padNotes.push(note(root + 12, beat, 16, 60)); // Root
            padNotes.push(note(root + 15 + (chordIdx === 2 || chordIdx === 3 ? 1 : 0), beat, 16, 60)); // Third
            padNotes.push(note(root + 19, beat, 16, 60)); // Fifth
        }

        // Pluck Arp (16th notes starting at beat 32)
        if (beat >= 32) {
            for (let sixteenth = 0; sixteenth < 4; sixteenth++) {
                const stepBeat = beat + sixteenth * 0.25;
                const notePitch = sixteenth % 2 === 0 ? root + 24 : root + 31; // Octave or Fifth
                pluckNotes.push(note(notePitch, stepBeat, 0.2, 70 + Math.random() * 20));
            }
        }

        // Lead Melody (starting at beat 64)
        if (beat >= 64 && beat < 120) {
            if (beat % 8 === 0) leadNotes.push(note(root + 36, beat, 2, 90));
            if (beat % 8 === 2) leadNotes.push(note(root + 39 + (chordIdx >= 2 ? 1 : 0), beat, 1, 85));
            if (beat % 8 === 3.5) leadNotes.push(note(root + 36, beat, 0.5, 80));
            if (beat % 8 === 4) leadNotes.push(note(root + 43, beat, 1.5, 95));
        }
    }

    const tracks = [
        masterTrack, kickTrack, snareTrack, hatTrack, percTrack, voxTrack,
        subBassTrack, midBassTrack, padTrack, pluckTrack, leadTrack
    ];

    trackStore.set({ tracks, selectedTrackId: leadTrack.id });

    midiStore.set({
        notesByClipId: {
            [subClip.id]: subNotes,
            [midBassClip.id]: midBassNotes,
            [padClip.id]: padNotes,
            [pluckClip.id]: pluckNotes,
            [leadClip.id]: leadNotes,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({
        ...defaultTransportState,
        tempo: bpm,
        loopEnd: totalBeats,
        isLooping: true,
    });

    // Automations (Volume on Pad, Pan on Hat, Filter on Analog Bass)
    const padVolLane = createAutomationLane(padTrack.id, 'volume', 'Volume', 0, 1);
    padVolLane.points = [
        { beat: 0, value: 0, curve: 'linear', tension: 0 },
        { beat: 32, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 112, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 128, value: 0, curve: 'linear', tension: 0 },
    ];

    const hatPanLane = createAutomationLane(hatTrack.id, 'pan', 'Pan', -1, 1);
    hatPanLane.points = [];
    // Auto-pan swinging left to right every 4 beats
    for (let b = 0; b <= totalBeats; b += 4) {
        hatPanLane.points.push({ beat: b, value: (b / 4) % 2 === 0 ? -0.4 : 0.4, curve: 'linear', tension: 0 });
    }

    const bassFilterLane = createAutomationLane(midBassTrack.id, 'filterCutoff', 'Filter Cutoff', 20, 20000);
    bassFilterLane.points = [
        { beat: 0, value: 200, curve: 'linear', tension: 0 },
        { beat: 64, value: 3000, curve: 'linear', tension: 0 },
        { beat: 96, value: 5000, curve: 'linear', tension: 0 },
        { beat: 128, value: 200, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [padVolLane, hatPanLane, bassFilterLane],
    });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), beat: 32, name: 'Verse', color: '#77dd77' },
            { id: crypto.randomUUID(), beat: 64, name: 'Chorus', color: '#ff6961' },
            { id: crypto.randomUUID(), beat: 96, name: 'Outro', color: '#aec6cf' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 32, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), startBeat: 32, endBeat: 64, name: 'Verse', color: '#77dd77' },
            { id: crypto.randomUUID(), startBeat: 64, endBeat: 96, name: 'Chorus', color: '#ff6961' },
            { id: crypto.randomUUID(), startBeat: 96, endBeat: 128, name: 'Outro', color: '#aec6cf' },
        ],
    });

    syncArrangement(tracks);

    projectStore.set({
        name: 'The Complete Mix (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
    });
}

// ---------------------------------------------------------------------------
// Demo Project 2: Electronic Beat
// ---------------------------------------------------------------------------

export async function demo2_ElectronicBeat(): Promise<void> {
    const bpm = 128;
    const totalBeats = 64; // 30 seconds at 128 BPM
    const audioTrack = createTrack({ name: 'Beat', kind: 'audio' });
    const compTrack = createTrack({ name: 'Sub Bass', kind: 'midi' });
    const arpTrack = createTrack({ name: 'Arp Pluck', kind: 'midi' });
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    const drumBufferId = `demo2-drums-${Date.now()}`;
    await generateDemoDrumBuffer(drumBufferId, totalBeats, bpm, 'electro');

    const drumClip = createAudioClip(audioTrack.id, 'Heavy Loop', 0, totalBeats, drumBufferId);
    drumClip.stretchMode = 'timestretch';

    const arpClip = createMidiClip(arpTrack.id, 'Arpeggiation', 0, totalBeats);
    const subClip = createMidiClip(compTrack.id, 'Sub Bass', 0, totalBeats);

    audioTrack.clips = [drumClip];
    arpTrack.clips = [arpClip];
    compTrack.clips = [subClip];

    const arpNotes: MidiNote[] = [];
    const subNotes: MidiNote[] = [];

    // Generate 64 beats of fast arpeggios
    for (let i = 0; i < totalBeats; i++) {
        const root = i < 32 ? 43 : 48; // G or C

        subNotes.push(note(root - 12, i, 0.75, 110));

        // 16th notes
        for (let j = 0; j < 4; j++) {
            const pitch = root + (j % 2 === 0 ? 0 : 7) + (j === 3 ? 12 : 0);
            arpNotes.push(note(pitch, i + j * 0.25, 0.2, 80 + Math.random() * 20));
        }
    }

    const tracks = [masterTrack, audioTrack, compTrack, arpTrack];
    trackStore.set({ tracks, selectedTrackId: audioTrack.id });

    midiStore.set({
        notesByClipId: { [arpClip.id]: arpNotes, [subClip.id]: subNotes },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({
        ...defaultTransportState,
        tempo: bpm,
        loopEnd: totalBeats,
        isLooping: true,
    });

    // Clear stores that aren't used
    automationStore.set({ lanes: [] });
    markerStore.set({ markers: [], sections: [] });

    syncArrangement(tracks);

    projectStore.set({
        name: 'Electronic Beat (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
    });
}

// ---------------------------------------------------------------------------
// Demo Project 3: Acoustic Session
// ---------------------------------------------------------------------------

export async function demo3_AcousticSession(): Promise<void> {
    const bpm = 90;
    const totalBeats = 48; // 32 seconds at 90 BPM
    const voxTrack = createTrack({ name: 'Lead Vocal', kind: 'audio' });
    const guitarTrack = createTrack({ name: 'Acoustic Guitar', kind: 'midi' });
    const shakerTrack = createTrack({ name: 'Shaker', kind: 'audio' });
    const masterTrack = createTrack({ name: 'Master', kind: 'master' });

    guitarTrack.pan = -0.3;
    voxTrack.pan = 0.0;
    shakerTrack.pan = 0.4;

    const vocalBufferId = `demo3-vox-${Date.now()}`;
    await generateSyntheticToneBuffer(vocalBufferId, totalBeats, bpm, 330); // E4 tone substitute

    const shakerBufferId = `demo3-shaker-${Date.now()}`;
    await generateDemoDrumBuffer(shakerBufferId, totalBeats, bpm, 'shaker');

    const voxClip = createAudioClip(voxTrack.id, 'Vocal Take', 8, totalBeats, vocalBufferId);
    voxClip.fadeInBeats = 2;
    voxClip.fadeOutBeats = 2;

    const shakerClip = createAudioClip(shakerTrack.id, 'Shaker Loop', 0, totalBeats, shakerBufferId);
    shakerClip.gain = 0.6;

    const guitarClip = createMidiClip(guitarTrack.id, 'Chords', 0, totalBeats);

    voxTrack.clips = [voxClip];
    shakerTrack.clips = [shakerClip];
    guitarTrack.clips = [guitarClip];

    const guitarNotes: MidiNote[] = [];

    // Acoustic strumming pattern
    for (let i = 0; i < totalBeats / 4; i++) {
        const root = i % 4 === 0 ? 59 : i % 4 === 1 ? 64 : i % 4 === 2 ? 62 : 61; // B, E, D, Db
        const offset = i * 4;

        // Downstroke
        guitarNotes.push(note(root - 12, offset, 4, 90));
        guitarNotes.push(note(root, offset + 0.05, 4, 80));
        guitarNotes.push(note(root + 4, offset + 0.1, 4, 75));
        guitarNotes.push(note(root + 7, offset + 0.15, 4, 80));

        // Upstroke on beat 2.5
        guitarNotes.push(note(root + 12, offset + 2.5, 0.5, 70));
        guitarNotes.push(note(root + 7, offset + 2.52, 0.5, 65));
        guitarNotes.push(note(root + 4, offset + 2.54, 0.5, 60));
    }

    const tracks = [masterTrack, guitarTrack, voxTrack, shakerTrack];
    trackStore.set({ tracks, selectedTrackId: voxTrack.id });

    midiStore.set({
        notesByClipId: { [guitarClip.id]: guitarNotes },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    transportStore.set({
        ...defaultTransportState,
        tempo: bpm,
        loopEnd: totalBeats,
        isLooping: true,
    });

    automationStore.set({ lanes: [] });
    markerStore.set({ markers: [], sections: [] });
    syncArrangement(tracks);

    projectStore.set({
        name: 'Acoustic Session (Demo)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
    });
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
        const ctx = new OfflineAudioContext(2, 44100 * Math.ceil(durationSecs), 44100);

        for (let beat = 0; beat < beats; beat++) {
            const time = beat / bps;

            if (style === 'shaker') {
                if (beat % 0.5 === 0) {
                    const vol = beat % 1 === 0 ? 0.3 : 0.15;
                    createNoiseBurst(ctx, time, 0.05, vol, 'highpass', 4000);
                }
                continue;
            }

            const isKick = style === '4onFloor' || style === 'kick' ? beat % 1 === 0 : (style === 'electro' ? beat % 4 === 0 || beat % 4 === 2.5 : false);
            const isSnare = style === 'snare' ? beat % 2 === 1 : (style === 'electro' ? beat % 2 === 1 : false);
            const isHat = style === 'hat' ? beat % 0.5 === 0 : (style === '4onFloor' ? beat % 0.5 === 0 && beat % 1 !== 0 : false);

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
            if (isSnare && style !== '4onFloor') {
                createNoiseBurst(ctx, time, 0.15, 0.6, 'highpass', 2000);
            }
            if (isHat || (style === '4onFloor' && isSnare)) {
                createNoiseBurst(ctx, time, 0.06, 0.25, 'highpass', 8000);
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

async function generateSyntheticToneBuffer(
    bufferId: string,
    beats: number,
    bpm: number,
    freq: number
): Promise<void> {
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
