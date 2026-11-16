import { Profiler } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { hydrateTracksForProject, setTrackState } from '#/modules/Arrangement/useCases';

import { makeTrackDummy } from '../../../__tests__/TrackDummy';
import { useShellTrackFacts } from '../useShellTrackFacts';

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
        hydrateTracksForProject({ tracks: [makeTrackDummy()] });
    });

    afterEach(() => {
        hydrateTracksForProject({ tracks: [] });
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('does not render for a clip edit that changes none of the three facts', () => {
        mount('clip-1');
        renders = 0;

        setTracks([makeTrackDummy({ clipEndBeat: 8 })]);

        expect(renders).toBe(0);
    });

    it('renders with the new value when the selected clip is an audio clip', () => {
        const { result } = mount('clip-1');
        expect(result.current.isAudioClipSelected).toBe(false);
        renders = 0;

        setTracks([makeTrackDummy({ clipType: 'audio' })]);

        expect(result.current.isAudioClipSelected).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('renders with the new value when a track shows variation lanes', () => {
        const { result } = mount(null);
        expect(result.current.takesTabAvailable).toBe(false);
        renders = 0;

        setTracks([makeTrackDummy({ showVariationLanes: true })]);

        expect(result.current.takesTabAvailable).toBe(true);
        expect(result.current.variationLanesShown.get('track-1')).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('renders with the new value when a track is added with lanes on', () => {
        const { result } = mount(null);
        renders = 0;

        setTracks([makeTrackDummy(), makeTrackDummy({ id: 'track-2', showVariationLanes: true })]);

        expect(result.current.variationLanesShown.get('track-2')).toBe(true);
        expect(renders).toBeGreaterThan(0);
    });

    it('does not offer the Takes tab for a folder, whose lanes are never shown', () => {
        const { result } = mount(null);

        setTracks([makeTrackDummy({ kind: 'folder', showVariationLanes: true })]);

        expect(result.current.takesTabAvailable).toBe(false);
        expect(result.current.variationLanesShown.get('track-1')).toBe(false);
    });

    it('reports an audio clip selected only when the selected clip id is an audio clip', () => {
        const midiTrack = makeTrackDummy();
        const audioTrack = (id: string): Track => makeTrackDummy({ id, clipId: `${id}-clip`, clipType: 'audio' });
        hydrateTracks([midiTrack, audioTrack('audio-1'), audioTrack('audio-2')]);

        expect(mount('clip-1').result.current.isAudioClipSelected).toBe(false);
        expect(mount('audio-1-clip').result.current.isAudioClipSelected).toBe(true);
        expect(mount('missing').result.current.isAudioClipSelected).toBe(false);
    });

    it('renders with the new value when lanes switch back off', () => {
        hydrateTracksForProject({ tracks: [makeTrackDummy({ showVariationLanes: true })] });
        const { result } = mount(null);
        renders = 0;

        setTracks([makeTrackDummy()]);

        expect(result.current.takesTabAvailable).toBe(false);
        expect(renders).toBeGreaterThan(0);
    });
});
