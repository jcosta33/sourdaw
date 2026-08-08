import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyUser = vi.fn();

const trackStoreMock = vi.hoisted(() => {
    const value: unknown = null;
    return { value };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackStoreMock,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (...args: unknown[]) => notifyUser(...args),
}));

import { type Clip, type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { defaultMissingMediaStoreState, missingMediaStore } from '../../../../stores/missingMediaStore';
import { verifyAudioBufferReferences } from '../verifyAudioBufferReferences';

function makeClip(overrides: Partial<Clip>): Clip {
    return {
        id: 'clip',
        trackId: 'track',
        name: 'Clip',
        startBeat: 0,
        endBeat: 1,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function makeTrack(overrides: Partial<Track>): Track {
    return {
        id: 'track',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#fff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
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
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function makeTrackState(tracks: Track[]): TrackStoreState {
    return { tracks, selectedTrackId: null };
}

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        notifyUser.mockClear();
        vi.mocked(getCachedAudioBuffer).mockReset();
        trackStoreMock.value = null;
    });

    it('should not notify when track state is null', () => {
        verifyAudioBufferReferences();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should not notify when all referenced audio buffers exist', () => {
        const cached_buffer: AudioBuffer = {
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            duration: 1,
            getChannelData: vi.fn(() => new Float32Array(1)),
            length: 1,
            numberOfChannels: 1,
            sampleRate: 48000,
        };
        vi.mocked(getCachedAudioBuffer).mockReturnValue(cached_buffer);
        trackStoreMock.value = makeTrackState([
            makeTrack({ clips: [makeClip({ name: 'ok', audioBufferId: 'buf-1' })] }),
        ]);

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should notify with clip names when an audio clip references a missing buffer', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = makeTrackState([
            makeTrack({ clips: [makeClip({ name: 'missing-clip', audioBufferId: 'gone' })] }),
        ]);

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'gone' });
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/missing-clip/), 'warning');
    });

    it('should notify with frozen track names when a frozen track references a missing buffer', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = makeTrackState([
            makeTrack({
                name: 'Frozen Piano',
                freezeState: { status: 'frozen', frozenBufferId: 'frozen-gone' },
            }),
        ]);

        verifyAudioBufferReferences();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'frozen-gone' });
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/Frozen track Frozen Piano/), 'warning');
    });

    it('should summarize when more than three clips are missing buffers', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        trackStoreMock.value = makeTrackState([
            makeTrack({
                clips: [
                    makeClip({ id: 'clip-a', name: 'a', audioBufferId: '1' }),
                    makeClip({ id: 'clip-b', name: 'b', audioBufferId: '2' }),
                    makeClip({ id: 'clip-c', name: 'c', audioBufferId: '3' }),
                    makeClip({ id: 'clip-d', name: 'd', audioBufferId: '4' }),
                ],
            }),
        ]);

        verifyAudioBufferReferences();

        expect(notifyUser).toHaveBeenCalledWith(expect.stringMatching(/and 1 more/), 'warning');
    });

    describe('durable record', () => {
        beforeEach(() => {
            missingMediaStore.set(defaultMissingMediaStoreState);
        });

        it('records the clip id so a relink has a target, alongside the owning track', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
            trackStoreMock.value = makeTrackState([
                makeTrack({
                    id: 'track-7',
                    name: 'Guitars',
                    clips: [makeClip({ id: 'clip-9', name: 'Lost Take', audioBufferId: 'gone' })],
                }),
            ]);

            verifyAudioBufferReferences();

            expect(missingMediaStore.value?.items).toEqual([
                {
                    bufferId: 'gone',
                    clipId: 'clip-9',
                    kind: 'clip',
                    label: 'Lost Take',
                    trackId: 'track-7',
                    trackName: 'Guitars',
                },
            ]);
        });

        it('marks a frozen track with no clip id, because it has no relink target', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
            trackStoreMock.value = makeTrackState([
                makeTrack({
                    id: 'track-3',
                    name: 'Pad',
                    freezeState: { status: 'frozen', frozenBufferId: 'frozen-gone' },
                }),
            ]);

            verifyAudioBufferReferences();

            const item = missingMediaStore.value?.items[0];
            expect(item?.kind).toBe('frozenTrack');
            expect(item?.clipId).toBeUndefined();
            expect(item?.bufferId).toBe('frozen-gone');
        });

        it('clears a prior record when a later scan resolves everything', () => {
            missingMediaStore.set({
                items: [
                    {
                        bufferId: 'stale',
                        clipId: 'stale-clip',
                        kind: 'clip',
                        label: 'Stale',
                        trackId: 'stale-track',
                        trackName: 'Stale',
                    },
                ],
                scannedAt: 1,
            });
            vi.mocked(getCachedAudioBuffer).mockReturnValue({
                copyFromChannel: vi.fn(),
                copyToChannel: vi.fn(),
                duration: 1,
                getChannelData: vi.fn(() => new Float32Array(1)),
                length: 1,
                numberOfChannels: 1,
                sampleRate: 48_000,
            });
            trackStoreMock.value = makeTrackState([
                makeTrack({ clips: [makeClip({ name: 'ok', audioBufferId: 'buf-1' })] }),
            ]);

            verifyAudioBufferReferences();

            expect(missingMediaStore.value?.items).toEqual([]);
            expect(missingMediaStore.value?.scannedAt).toBeGreaterThan(1);
        });

        it('clears a prior record when there is no track state to make a claim about', () => {
            missingMediaStore.set({
                items: [
                    {
                        bufferId: 'stale',
                        clipId: 'stale-clip',
                        kind: 'clip',
                        label: 'Stale',
                        trackId: 'stale-track',
                        trackName: 'Stale',
                    },
                ],
                scannedAt: 1,
            });
            trackStoreMock.value = null;

            verifyAudioBufferReferences();

            expect(missingMediaStore.value?.items).toEqual([]);
            expect(notifyUser).not.toHaveBeenCalled();
        });
    });
});
