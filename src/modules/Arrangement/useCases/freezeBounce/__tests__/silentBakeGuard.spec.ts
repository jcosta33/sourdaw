import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { setMidiStoreState } from '#/modules/MIDI/useCases';

import { createTrack, type Clip, type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { bounceTrack } from '../bounceTrack';
import { flattenTrack } from '../flattenTrack';
import { freezeTrack } from '../freezeTrack';
import { renderTrackOffline } from '../renderOffline';

vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCompensationDelay: vi.fn(() => 0),
}));

const notification = vi.hoisted(() => ({ notifyUser: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notification.notifyUser }));

/**
 * A buffer of pure digital silence — exactly what an instrument whose offline
 * node never produced sound hands back.
 */
function createSilentBuffer(): AudioBuffer {
    const channel = new Float32Array(4410);
    return {
        length: channel.length,
        duration: 0.1,
        sampleRate: 44_100,
        numberOfChannels: 2,
        getChannelData: () => channel,
    } as any;
}

function createAudibleBuffer(): AudioBuffer {
    const channel = new Float32Array(4410);
    channel[100] = 0.5;
    return {
        length: channel.length,
        duration: 0.1,
        sampleRate: 44_100,
        numberOfChannels: 2,
        getChannelData: () => channel,
    } as any;
}

function createMidiClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'clip-1',
        trackId: 't1',
        name: 'Verse',
        startBeat: 0,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function seedTrack(clips: Clip[], overrides: Partial<Track> = {}): Track {
    const base = createTrack({ id: 't1', name: 'Grand Piano', kind: 'midi' });
    const track: Track = {
        ...base,
        clips,
        alternatives: [{ id: base.activeAlternativeId, name: 'Alternative 1', clips }],
        ...overrides,
    };
    trackStore.set({ tracks: [track], selectedTrackId: null });
    return track;
}

function givenNotesFor(clipId: string): void {
    setMidiStoreState({
        notesByClipId: { [clipId]: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

describe('silent bake guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('refuses to flatten a MIDI track whose freeze baked digital silence', async () => {
        const clip = createMidiClip();
        const seeded = seedTrack([clip]);
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');
        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(false);
        expect(after?.clips).toEqual([clip]);
        expect(after?.devices).toEqual(seeded.devices);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Grand Piano'), 'error');
    });

    // The freeze-side refusal keeps new silent buffers out of the project, so
    // the flatten-side guard is reached only by a buffer this session did not
    // bake: a project loaded with a frozen track, or one frozen by a build that
    // predates the guard. These seed that state directly.
    it('refuses to flatten a track frozen before the freeze-side guard existed', () => {
        const clip = createMidiClip();
        const seeded = seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'legacy-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'legacy-buf' },
        });
        givenNotesFor(clip.id);
        cacheAudioBuffer({ buffer: createSilentBuffer(), bufferId: 'legacy-buf' });

        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(false);
        expect(after?.clips).toEqual([clip]);
        expect(after?.devices).toEqual(seeded.devices);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Flatten'), 'error');
    });

    it('flattens a track whose pre-existing frozen buffer carries audio', () => {
        const clip = createMidiClip();
        seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'audible-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'audible-buf' },
        });
        givenNotesFor(clip.id);
        cacheAudioBuffer({ buffer: createAudibleBuffer(), bufferId: 'audible-buf' });

        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(true);
        expect(after?.clips[0]?.audioBufferId).toBe('audible-buf');
        expect(after?.devices).toEqual([]);
    });

    it('flattens when the frozen buffer is absent from the cache and cannot be judged', () => {
        const clip = createMidiClip();
        seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'evicted-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'evicted-buf' },
        });
        givenNotesFor(clip.id);

        const didFlatten = flattenTrack('t1');

        expect(didFlatten).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses to commit a freeze whose render is digital silence', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('error');
        expect(after?.freezeState.frozenBufferId).toBeUndefined();
        expect(after?.frozen).toBe(false);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Grand Piano'), 'error');
    });

    // A zero fader excuses a *bounce*, which bakes it, but never a freeze or a
    // flatten: `targetMixer: 'keepLive'` prints the target at unity and the
    // live fader is applied again at replay, so a silent print is still wrong.
    it('refuses a silent freeze even when the track fader sits at zero', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { gain: 0 });
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('error');
    });

    it('refuses a silent flatten even when the track fader sits at zero', () => {
        const clip = createMidiClip();
        seedTrack([clip], {
            gain: 0,
            frozen: true,
            frozenBufferId: 'zero-fader-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'zero-fader-buf' },
        });
        givenNotesFor(clip.id);
        cacheAudioBuffer({ buffer: createSilentBuffer(), bufferId: 'zero-fader-buf' });

        const didFlatten = flattenTrack('t1');

        expect(didFlatten).toBe(false);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([clip]);
    });

    it('refuses a replace-bounce whose render is digital silence', async () => {
        const clip = createMidiClip();
        const seeded = seedTrack([clip]);
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        const didBounce = await bounceTrack('t1', {
            includeInserts: true,
            includeSends: true,
            includeAutomation: true,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        const after = trackStore.value?.tracks[0];
        expect(didBounce).toBe(false);
        expect(after?.clips).toEqual([clip]);
        expect(after?.devices).toEqual(seeded.devices);
    });

    it('still freezes a track whose render carries audio', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createAudibleBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('frozen');
        expect(after?.frozen).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    // ── Legitimate silence, through the real stores the guard consults ──────

    it('freezes a muted track that renders silent, without complaint', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { muted: true });
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('freezes a track another track’s solo is gating, without complaint', async () => {
        const clip = createMidiClip();
        const target: Track = {
            ...createTrack({ id: 't1', name: 'Grand Piano', kind: 'midi' }),
            clips: [clip],
        };
        const soloed: Track = { ...createTrack({ id: 't2', name: 'Drums', kind: 'midi' }), soloed: true };
        trackStore.set({ tracks: [target, soloed], selectedTrackId: null });
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks.find((candidate) => candidate.id === 't1');
        expect(after?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('freezes an empty track that renders silent, without complaint', async () => {
        seedTrack([]);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('freezes a track whose only MIDI clip has no notes, without complaint', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('flattens a muted track whose frozen buffer is silent, without complaint', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { muted: true });
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        await freezeTrack('t1');
        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(true);
        expect(after?.clips).toHaveLength(1);
        expect(after?.clips[0]?.type).toBe('audio');
        expect(after?.devices).toEqual([]);
    });

    it('refuses a bounce that keeps the track fader, but only when the fader is open', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { gain: 0 });
        givenNotesFor(clip.id);
        vi.mocked(renderTrackOffline).mockResolvedValue(createSilentBuffer());

        const didBounce = await bounceTrack('t1', {
            includeInserts: true,
            includeSends: true,
            includeAutomation: true,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        // The fader is at zero and this bounce bakes it, so the silence is what
        // the user asked for and the replacement goes through.
        expect(didBounce).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });
});
