import { trackStore } from '../stores/trackStore';
import { midiStore } from '../stores/midiStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { buildDeviceChain } from '#/modules/AudioEngine/useCases/buildDeviceChain';
import { type Clip, type Track } from '../models/Track';

let frozenClipId = 1;

const MIDI_FREQUENCIES: Record<number, number> = {};
for (let n = 0; n < 128; n++) {
    MIDI_FREQUENCIES[n] = 440 * 2 ** ((n - 69) / 12);
}

async function renderTrackOffline(track: Track, startBeat: number, endBeat: number): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const sampleRate = 44100;
    const durationSeconds = (durationBeats / tempo) * 60;
    const midi = midiStore.value;

    if (track.kind === 'midi' && midi) {
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;
        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;
        buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        for (const clip of track.clips) {
            if (clip.type !== 'midi') {
                continue;
            }
            const notes = midi.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            for (const note of notes) {
                const noteStart = ((clip.startBeat - startBeat + note.startBeat) / tempo) * 60;
                const noteDur = (note.duration / tempo) * 60;
                if (noteStart >= durationSeconds || noteStart < 0) {
                    continue;
                }

                const freq = MIDI_FREQUENCIES[note.pitch] ?? 440;
                const osc = offlineCtx.createOscillator();
                const env = offlineCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                env.gain.setValueAtTime(0, noteStart);
                env.gain.linearRampToValueAtTime((note.velocity / 127) * 0.3, noteStart + 0.005);
                env.gain.setValueAtTime((note.velocity / 127) * 0.3, noteStart + noteDur - 0.01);
                env.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDur);
                osc.connect(env);
                env.connect(trackGain);
                osc.start(noteStart);
                osc.stop(noteStart + noteDur + 0.01);
            }
        }

        return offlineCtx.startRendering();
    }

    if (track.kind === 'audio') {
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;
        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;
        buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        for (const clip of track.clips) {
            const buffer = audioBufferCache.get(clip.audioBufferId ?? '');
            if (!buffer) {
                continue;
            }
            const clipStart = ((clip.startBeat - startBeat) / tempo) * 60;
            const clipDuration = ((clip.endBeat - clip.startBeat) / tempo) * 60;
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(trackGain);
            source.start(Math.max(0, clipStart), 0, Math.min(clipDuration, buffer.duration));
        }

        return offlineCtx.startRendering();
    }

    return null;
}

export async function freezeTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        trackStore.set({
            ...state,
            tracks: state.tracks.map((t) => {
                if (t.id !== trackId) {
                    return t;
                }
                return { ...t, frozen: true };
            }),
        });
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);

    const frozenBufferId = renderedBuffer ? `frozen-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && frozenBufferId) {
        audioBufferCache.set(frozenBufferId, renderedBuffer);
    }

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    trackStore.set({
        ...freshState,
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                frozen: true,
                frozenBufferId,
                devices: t.devices.map((d) => ({ ...d, bypassed: true })),
            };
        }),
    });
}

export function unfreezeTrack(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (track?.frozenBufferId) {
        audioBufferCache.remove(track.frozenBufferId);
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                frozen: false,
                frozenBufferId: undefined,
                devices: t.devices.map((d) => ({ ...d, bypassed: false })),
            };
        }),
    });
}

export async function bounceInPlace(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);

    const audioBufferId = renderedBuffer ? `bounce-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const bouncedClip: Clip = {
        id: `frozen-clip-${frozenClipId++}`,
        trackId,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    trackStore.set({
        ...freshState,
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                clips: [bouncedClip],
                devices: [],
            };
        }),
    });
}

export async function bounceToNewTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);
    const audioBufferId = renderedBuffer ? `bounce-new-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const newTrackId = `track-bounce-${Date.now()}`;
    const bouncedClip: Clip = {
        id: `bounced-new-${frozenClipId++}`,
        trackId: newTrackId,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    const newTrack: Track = {
        id: newTrackId,
        name: `${track.name} (bounce)`,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: track.color,
        clips: [bouncedClip],
        devices: [],
        sends: [],
        frozen: false,
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        alternatives: [{ id: 'alt-main', name: 'Main', clips: [bouncedClip] }],
        activeAlternativeId: 'alt-main',
        vcaGroupId: null,
        midiOutputTrackId: null,
    };

    const insertIndex = freshState.tracks.findIndex((t) => t.id === trackId) + 1;
    const tracks = [...freshState.tracks];
    tracks.splice(insertIndex, 0, newTrack);

    trackStore.set({ ...freshState, tracks });
}

export async function bounceSelection(trackId: string, startBeat: number, endBeat: number): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    const clipsInRange = track.clips.filter((c) => c.endBeat > startBeat && c.startBeat < endBeat);
    if (clipsInRange.length === 0) {
        return;
    }

    const virtualTrack: Track = {
        ...track,
        clips: clipsInRange.map((c) => ({
            ...c,
            startBeat: Math.max(c.startBeat, startBeat),
            endBeat: Math.min(c.endBeat, endBeat),
        })),
    };

    const renderedBuffer = await renderTrackOffline(virtualTrack, startBeat, endBeat);

    const audioBufferId = renderedBuffer ? `bounce-sel-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const bouncedClip: Clip = {
        id: `bounced-sel-${frozenClipId++}`,
        trackId,
        name: `${track.name} (selection bounce)`,
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    trackStore.set({
        ...freshState,
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            const keptClips = t.clips.filter((c) => c.endBeat <= startBeat || c.startBeat >= endBeat);
            return {
                ...t,
                clips: [...keptClips, bouncedClip],
            };
        }),
    });
}
