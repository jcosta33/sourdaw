import { Profiler } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { hydrateTracksForProject, setTrackState } from '#/modules/Arrangement/useCases';

import { useShellTrackFacts } from '../useShellTrackFacts';

type TrackOptions = { clipType?: Clip['type']; clipEndBeat?: number; showVariationLanes?: boolean };

const makeTrack = ({ clipType = 'midi', clipEndBeat = 4, showVariationLanes = false }: TrackOptions = {}): Track => {
    const clip: Clip = {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Clip',
        type: clipType,
        startBeat: 0,
        endBeat: clipEndBeat,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
    return {
        id: 'track-1',
        name: 'Track',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [clip],
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
        height: 64,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'track-1-alternative',
        alternatives: [{ id: 'track-1-alternative', name: 'Main', clips: [clip] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        showVariationLanes,
    };
};

const hydrateTracks = (tracks: Track[]): void => {
    act(() => {
        hydrateTracksForProject({ tracks });
    });
};

const setTracks = (tracks: Track[]): void => {
    act(() => {
        setTrackState({ tracks, selectedTrackId: null });
    });
};

describe('useShellTrackFacts', () => {
    let renders = 0;
    const mount = (selectedClipId: string | null) =>
        renderHook(() => useShellTrackFacts(selectedClipId), {
            wrapper: ({ children }) => (
                <Profiler
                    id="shell-track-facts"
                    onRender={() => {
                        renders += 1;
                    }}
                >
                    {children}
                </Profiler>
            ),
        });

    beforeEach(() => {
        renders = 0;
        hydrateTracksForProject({ tracks: [makeTrack()] });
    });

    afterEach(() => {
        hydrateTracksForProject({ tracks: [] });
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('does not render for a clip edit that changes none of the three facts', () => {
        mount('clip-1');
        renders = 0;

        setTracks([makeTrack({ clipEndBeat: 8 })]);

        expect(renders).toBe(0);
    });

    it('renders with the new value when the selected clip is an audio clip', () => {
        const { result } = mount('clip-1');
        expect(result.current.isAudioClipSelected).toBe(false);
        renders = 0;

        setTracks([makeTrack({ clipType: 'audio' })]);

        expect(result.current.isAudioClipSelected).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('renders with the new value when a track shows variation lanes', () => {
        const { result } = mount(null);
        expect(result.current.takesTabAvailable).toBe(false);
        renders = 0;

        setTracks([makeTrack({ showVariationLanes: true })]);

        expect(result.current.takesTabAvailable).toBe(true);
        expect(result.current.variationLanesShown.get('track-1')).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('renders with the new value when a track is added with lanes on', () => {
        const { result } = mount(null);
        renders = 0;

        setTracks([makeTrack(), { ...makeTrack({ showVariationLanes: true }), id: 'track-2' }]);

        expect(result.current.variationLanesShown.get('track-2')).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('does not offer the Takes tab for a folder, whose lanes are never shown', () => {
        const { result } = mount(null);

        setTracks([{ ...makeTrack({ showVariationLanes: true }), kind: 'folder' }]);

        expect(result.current.takesTabAvailable).toBe(false);
        expect(result.current.variationLanesShown.get('track-1')).toBe(false);
    });

    it('reports an audio clip selected only when the selected clip id is an audio clip', () => {
        const midiTrack = makeTrack();
        const audioTrack = (id: string): Track => {
            const track = makeTrack({ clipType: 'audio' });
            const clip = { ...track.clips[0]!, id: `${id}-clip`, trackId: id };
            return {
                ...track,
                id,
                clips: [clip],
                alternatives: [{ id: `${id}-alternative`, name: 'Main', clips: [clip] }],
            };
        };
        hydrateTracks([midiTrack, audioTrack('audio-1'), audioTrack('audio-2')]);

        expect(mount('clip-1').result.current.isAudioClipSelected).toBe(false);
        expect(mount('audio-1-clip').result.current.isAudioClipSelected).toBe(true);
        expect(mount('missing').result.current.isAudioClipSelected).toBe(false);
    });

    it('renders with the new value when lanes switch back off', () => {
        hydrateTracksForProject({ tracks: [makeTrack({ showVariationLanes: true })] });
        const { result } = mount(null);
        renders = 0;

        setTracks([makeTrack()]);

        expect(result.current.takesTabAvailable).toBe(false);
        expect(renders).toBeGreaterThan(0);
    });
});
