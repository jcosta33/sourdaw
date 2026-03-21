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
// Demo Project 1: The Complete Mix (10+ Tracks)
// ---------------------------------------------------------------------------

export async function demo1_TheCompleteMix(): Promise<void> {
    const bpm = 125;
    const totalBeats = 256; // ~2 minutes at 125 BPM

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
        generateSyntheticToneBuffer(bufVox, totalBeats, bpm, 440), // A4 tone for vocals
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
    const leadClip = createMidiClip(leadTrack.id, 'Main Melody', 64, 224); // Enters at beat 64, exits early

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
        if (chordIdx === 1) {
            root = 41;
        } // F2
        if (chordIdx === 2) {
            root = 48;
        } // C3
        if (chordIdx === 3) {
            root = 43;
        } // G2

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
        if (beat >= 64 && beat < 224) {
            if (beat % 8 === 0) {
                leadNotes.push(note(root + 36, beat, 2, 90));
            }
            if (beat % 8 === 2) {
                leadNotes.push(note(root + 39 + (chordIdx >= 2 ? 1 : 0), beat, 1, 85));
            }
            if (beat % 8 === 3.5) {
                leadNotes.push(note(root + 36, beat, 0.5, 80));
            }
            if (beat % 8 === 4) {
                leadNotes.push(note(root + 43, beat, 1.5, 95));
            }
        }
    }

    const tracks = [
        masterTrack,
        kickTrack,
        snareTrack,
        hatTrack,
        percTrack,
        voxTrack,
        subBassTrack,
        midBassTrack,
        padTrack,
        pluckTrack,
        leadTrack,
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
        { beat: 224, value: 0.8, curve: 'linear', tension: 0 },
        { beat: 256, value: 0, curve: 'linear', tension: 0 },
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
        { beat: 128, value: 2000, curve: 'linear', tension: 0 },
        { beat: 192, value: 6000, curve: 'linear', tension: 0 },
        { beat: 256, value: 200, curve: 'linear', tension: 0 },
    ];

    automationStore.set({
        lanes: [padVolLane, hatPanLane, bassFilterLane],
    });

    markerStore.set({
        markers: [
            { id: crypto.randomUUID(), beat: 0, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), beat: 32, name: 'Verse 1', color: '#77dd77' },
            { id: crypto.randomUUID(), beat: 64, name: 'Chorus 1', color: '#ff6961' },
            { id: crypto.randomUUID(), beat: 128, name: 'Verse 2', color: '#77dd77' },
            { id: crypto.randomUUID(), beat: 160, name: 'Chorus 2', color: '#ff6961' },
            { id: crypto.randomUUID(), beat: 224, name: 'Outro', color: '#aec6cf' },
        ],
        sections: [
            { id: crypto.randomUUID(), startBeat: 0, endBeat: 32, name: 'Intro', color: '#ffb347' },
            { id: crypto.randomUUID(), startBeat: 32, endBeat: 64, name: 'Verse 1', color: '#77dd77' },
            { id: crypto.randomUUID(), startBeat: 64, endBeat: 128, name: 'Chorus 1', color: '#ff6961' },
            { id: crypto.randomUUID(), startBeat: 128, endBeat: 160, name: 'Verse 2', color: '#77dd77' },
            { id: crypto.randomUUID(), startBeat: 160, endBeat: 224, name: 'Chorus 2', color: '#ff6961' },
            { id: crypto.randomUUID(), startBeat: 224, endBeat: 256, name: 'Outro', color: '#aec6cf' },
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

            const isKick =
                style === '4onFloor' || style === 'kick'
                    ? beat % 1 === 0
                    : style === 'electro'
                      ? beat % 4 === 0 || beat % 4 === 2.5
                      : false;
            const isSnare = style === 'snare' ? beat % 2 === 1 : style === 'electro' ? beat % 2 === 1 : false;
            const isHat =
                style === 'hat' ? beat % 0.5 === 0 && beat % 1 !== 0 : style === '4onFloor' ? beat % 0.5 === 0 && beat % 1 !== 0 : false;

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
