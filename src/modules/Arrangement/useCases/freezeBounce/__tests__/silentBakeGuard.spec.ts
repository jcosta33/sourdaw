import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';

import { createTrack, type Clip, type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { bounceSelection } from '../bounceSelection';
import { bounceTrack } from '../bounceTrack';
import { flattenTrack } from '../flattenTrack';
import { freezeTrack } from '../freezeTrack';
import { renderTrackOffline, type RenderScheduleTally } from '../renderOffline';

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

/** Pure digital silence — what an instrument node that never sounded hands back. */
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

/**
 * Stand in for the render: hand back `buffer` and report `tally` as what the
 * scheduler put into the graph, exactly as `renderTrackSubgraphOffline` does.
 */
function givenRender(buffer: AudioBuffer | null, tally: Partial<RenderScheduleTally> = {}): void {
    vi.mocked(renderTrackOffline).mockImplementation((_track, _start, _end, options) => {
        options?.onScheduled?.({ scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [], ...tally });
        return Promise.resolve(buffer);
    });
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

const BOUNCE_REPLACE = {
    includeInserts: true,
    includeSends: true,
    includeAutomation: true,
    normalization: 'off',
    tailHandling: 'off',
    destination: 'replace',
} as const;

describe('silent bake guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        automationStore.set(null);
        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    // ── The defect: silence baked over material the scheduler was feeding ───

    it('refuses to commit a freeze whose render is digital silence', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 12 });

        const didWrite = await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('error');
        expect(after?.freezeState.frozenBufferId).toBeUndefined();
        expect(after?.frozen).toBe(false);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Grand Piano'), 'error');
        // C3: `handleFreezeTrack` maps a truthy result to `{status: 'written'}`,
        // so a refusal reported as success files as an undoable edit.
        expect(didWrite).toBe(false);
    });

    it('names what reached the render in the refusal, so the user can tell it from an empty track', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 12 });

        await freezeTrack('t1');

        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('12 notes'), 'error');
    });

    it('refuses a replace-bounce whose render is digital silence', async () => {
        const clip = createMidiClip();
        const seeded = seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 3 });

        const didBounce = await bounceTrack('t1', BOUNCE_REPLACE);

        const after = trackStore.value?.tracks[0];
        expect(didBounce).toBe(false);
        expect(after?.clips).toEqual([clip]);
        expect(after?.devices).toEqual(seeded.devices);
    });

    it('refuses a selection bounce whose render is digital silence, before the MIDI is deleted', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 3 });

        const didBounce = await bounceSelection('t1', 0, 8);

        expect(didBounce).toBe(false);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([clip]);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Grand Piano'), 'error');
    });

    it('still freezes a track whose render carries audio', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createAudibleBuffer(), { scheduledNotes: 12 });

        const didWrite = await freezeTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(after?.freezeState.status).toBe('frozen');
        expect(after?.frozen).toBe(true);
        expect(didWrite).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    // ── Mute and solo do NOT excuse a freeze on this path ────────────────────
    //
    // Inverted from the first version of this guard, which excused both.
    // `renderTrackSubgraphOffline` passes `honorMuted: false` to the strip build
    // and to the clip scheduler, and never consults solo, because freeze and
    // bounce produce deliverable audio rather than a monitoring snapshot. A
    // muted track's freeze is therefore supposed to contain sound, and excusing
    // it disengaged the guard for every muted track — and for every unsoloed
    // track whenever a solo was up, which is routine while freezing.

    it('refuses a silent freeze on a muted track, because the offline render ignores mute', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { muted: true });
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 12 });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('error');
    });

    it('refuses a silent freeze while another track is soloed, because solo is never consulted here', async () => {
        const clip = createMidiClip();
        const target: Track = { ...createTrack({ id: 't1', name: 'Grand Piano', kind: 'midi' }), clips: [clip] };
        const soloed: Track = { ...createTrack({ id: 't2', name: 'Drums', kind: 'midi' }), soloed: true };
        trackStore.set({ tracks: [target, soloed], selectedTrackId: null });
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 12 });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks.find((candidate) => candidate.id === 't1')?.freezeState.status).toBe('error');
    });

    // ── Legitimate silence: the render was supposed to be quiet ─────────────

    it('freezes silently when the scheduler put nothing into the graph', async () => {
        // F1 and F2 both land here: a right-edge trim past the notes and an
        // all-zero-probability part are indistinguishable from an empty track
        // at this level, because the tally reports what the scheduler did.
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 0 });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('freezes an empty track that renders silent, without complaint', async () => {
        seedTrack([]);
        givenRender(createSilentBuffer(), { scheduledNotes: 0 });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('freezes a take that was recorded with no input, without complaint', async () => {
        // F4: the source is genuinely scheduled, so observation alone cannot
        // excuse it — the guard reads the source buffer's own samples.
        const clip = createMidiClip({ type: 'audio', audioBufferId: 'take-1' });
        seedTrack([clip]);
        givenRender(createSilentBuffer(), { scheduledBuffers: [createSilentBuffer()] });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('frozen');
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses when a scheduled take does carry audio but the render does not', async () => {
        const clip = createMidiClip({ type: 'audio', audioBufferId: 'take-1' });
        seedTrack([clip]);
        givenRender(createSilentBuffer(), { scheduledBuffers: [createAudibleBuffer()] });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('error');
    });

    it('refuses a silent freeze even when the track fader sits at zero', async () => {
        // A zero fader excuses a *bounce*, which bakes it, but never a freeze:
        // `targetMixer: 'keepLive'` prints the target at unity and the live
        // fader is applied again at replay, so a silent print is still wrong.
        const clip = createMidiClip();
        seedTrack([clip], { gain: 0 });
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 12 });

        await freezeTrack('t1');

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('error');
    });

    it('bounces a track whose fader the user parked at zero, without complaint', async () => {
        const clip = createMidiClip();
        seedTrack([clip], { gain: 0 });
        givenNotesFor(clip.id);
        givenRender(createSilentBuffer(), { scheduledNotes: 3 });

        const didBounce = await bounceTrack('t1', BOUNCE_REPLACE);

        expect(didBounce).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('bounces a track carrying a gain lane at the floor, without complaint', async () => {
        // F3: a bounce runs `targetMixer: 'bake'`, so a lane's absolute values
        // are written over the seeded fader, and lanes are painted linear
        // 0..1 — a lane held at the bottom is exactly zero and deliberate.
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        automationStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    parameterId: 'gain',
                    points: [{ id: 'p1', beat: 0, value: 0, curve: 'linear' }],
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        } as any);
        givenRender(createSilentBuffer(), { scheduledNotes: 3 });

        const didBounce = await bounceTrack('t1', BOUNCE_REPLACE);

        expect(didBounce).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });

    it('still refuses a silent bounce on a track whose only lane belongs to another track', async () => {
        const clip = createMidiClip();
        seedTrack([clip]);
        givenNotesFor(clip.id);
        automationStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'some-other-track',
                    parameterId: 'gain',
                    points: [{ id: 'p1', beat: 0, value: 0, curve: 'linear' }],
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        } as any);
        givenRender(createSilentBuffer(), { scheduledNotes: 3 });

        const didBounce = await bounceTrack('t1', BOUNCE_REPLACE);

        expect(didBounce).toBe(false);
    });

    // ── Flatten judges by a different rule, because it has no render to watch ─

    it('refuses to flatten a track frozen to a buffer with no audio in it', () => {
        const clip = createMidiClip();
        const seeded = seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'legacy-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'legacy-buf' },
        });
        cacheAudioBuffer({ buffer: createSilentBuffer(), bufferId: 'legacy-buf' });

        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(false);
        expect(after?.clips).toEqual([clip]);
        expect(after?.devices).toEqual(seeded.devices);
        expect(notification.notifyUser).toHaveBeenCalledWith(expect.stringContaining('no audio'), 'error');
    });

    it('flattens a track whose frozen buffer carries audio', () => {
        const clip = createMidiClip();
        seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'audible-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'audible-buf' },
        });
        cacheAudioBuffer({ buffer: createAudibleBuffer(), bufferId: 'audible-buf' });

        const didFlatten = flattenTrack('t1');

        const after = trackStore.value?.tracks[0];
        expect(didFlatten).toBe(true);
        expect(after?.clips[0]?.audioBufferId).toBe('audible-buf');
        expect(after?.devices).toEqual([]);
    });

    it('flattens when the frozen buffer is absent from the cache and cannot be read', () => {
        const clip = createMidiClip();
        seedTrack([clip], {
            frozen: true,
            frozenBufferId: 'evicted-buf',
            freezeState: { status: 'frozen', frozenBufferId: 'evicted-buf' },
        });

        const didFlatten = flattenTrack('t1');

        expect(didFlatten).toBe(true);
        expect(notification.notifyUser).not.toHaveBeenCalled();
    });
});
