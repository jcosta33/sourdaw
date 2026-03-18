import { trackStore } from '#/modules/Track/stores/trackStore';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { createTrack, createMidiNote } from '#/modules/Track/useCases/trackQueries';
import { projectStore } from '../stores/projectStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';

export async function createDemoProject(): Promise<void> {
    const audioTrack = createTrack({ name: 'Drums', kind: 'audio' });
    const midiTrack = createTrack({ name: 'Synth Lead', kind: 'midi' });
    const bassTrack = createTrack({ name: 'Bass', kind: 'midi' });

    const drumBufferId = 'demo-drum-buffer';
    await generateDemoDrumBuffer(drumBufferId);

    const drumClip = {
        id: 'demo-clip-1',
        trackId: audioTrack.id,
        name: 'Drum Loop',
        startBeat: 0,
        endBeat: 16,
        type: 'audio' as const,
        audioBufferId: drumBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const synthClip = {
        id: 'demo-clip-2',
        trackId: midiTrack.id,
        name: 'Melody',
        startBeat: 0,
        endBeat: 16,
        type: 'midi' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const bassClip = {
        id: 'demo-clip-3',
        trackId: bassTrack.id,
        name: 'Bassline',
        startBeat: 0,
        endBeat: 16,
        type: 'midi' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    audioTrack.clips = [drumClip];
    midiTrack.clips = [synthClip];
    bassTrack.clips = [bassClip];

    trackStore.set({
        tracks: [audioTrack, midiTrack, bassTrack],
        selectedTrackId: midiTrack.id,
    });

    const melodyNotes = [
        createMidiNote(72, 0, 1, 100),
        createMidiNote(74, 1, 0.5, 90),
        createMidiNote(76, 1.5, 0.5, 85),
        createMidiNote(79, 2, 2, 100),
        createMidiNote(77, 4, 1, 95),
        createMidiNote(76, 5, 0.5, 80),
        createMidiNote(74, 5.5, 0.5, 80),
        createMidiNote(72, 6, 2, 100),
        createMidiNote(72, 8, 1, 100),
        createMidiNote(74, 9, 0.5, 90),
        createMidiNote(76, 9.5, 0.5, 85),
        createMidiNote(79, 10, 1, 100),
        createMidiNote(81, 11, 1, 110),
        createMidiNote(79, 12, 2, 95),
        createMidiNote(76, 14, 2, 90),
    ];

    const bassNotes = [
        createMidiNote(48, 0, 2, 100),
        createMidiNote(48, 2, 1, 80),
        createMidiNote(48, 3, 1, 80),
        createMidiNote(53, 4, 2, 100),
        createMidiNote(53, 6, 1, 80),
        createMidiNote(53, 7, 1, 80),
        createMidiNote(55, 8, 2, 100),
        createMidiNote(55, 10, 1, 80),
        createMidiNote(55, 11, 1, 80),
        createMidiNote(52, 12, 2, 100),
        createMidiNote(52, 14, 2, 90),
    ];

    midiStore.set({
        notesByClipId: {
            [synthClip.id]: melodyNotes,
            [bassClip.id]: bassNotes,
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    projectStore.set({
        name: 'Demo Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
    });
}

async function generateDemoDrumBuffer(bufferId: string): Promise<void> {
    try {
        const ctx = new OfflineAudioContext(2, 44100 * 8, 44100);
        const bps = 120 / 60;

        for (let beat = 0; beat < 16; beat++) {
            const time = beat / bps;
            const isKick = beat % 4 === 0;
            const isSnare = beat % 4 === 2;
            const isHat = beat % 2 === 0;

            if (isKick) {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.frequency.setValueAtTime(150, time);
                osc.frequency.exponentialRampToValueAtTime(40, time + 0.08);
                env.gain.setValueAtTime(0.8, time);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
                osc.connect(env);
                env.connect(ctx.destination);
                osc.start(time);
                osc.stop(time + 0.2);
            }
            if (isSnare) {
                const noise = ctx.createBufferSource();
                const noiseBuf = ctx.createBuffer(1, 4410, 44100);
                const data = noiseBuf.getChannelData(0);
                for (let i = 0; i < data.length; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                noise.buffer = noiseBuf;
                const env = ctx.createGain();
                env.gain.setValueAtTime(0.6, time);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
                const hp = ctx.createBiquadFilter();
                hp.type = 'highpass';
                hp.frequency.value = 2000;
                noise.connect(hp);
                hp.connect(env);
                env.connect(ctx.destination);
                noise.start(time);
                noise.stop(time + 0.15);
            }
            if (isHat) {
                const noise = ctx.createBufferSource();
                const noiseBuf = ctx.createBuffer(1, 2205, 44100);
                const data = noiseBuf.getChannelData(0);
                for (let i = 0; i < data.length; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                noise.buffer = noiseBuf;
                const env = ctx.createGain();
                env.gain.setValueAtTime(0.25, time);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
                const hp = ctx.createBiquadFilter();
                hp.type = 'highpass';
                hp.frequency.value = 8000;
                noise.connect(hp);
                hp.connect(env);
                env.connect(ctx.destination);
                noise.start(time);
                noise.stop(time + 0.06);
            }
        }

        const rendered = await ctx.startRendering();
        audioBufferCache.set(bufferId, rendered);
    } catch {
        // OfflineAudioContext may not be available in some environments
    }
}
