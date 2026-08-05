import { describe, expect, it } from 'vitest';

import { collectProjectAudioBufferIds } from '../collectProjectAudioBufferIds';
import { type HydratableProjectData, type HydratableProjectTrack } from '../isHydratableProjectData';

function audioTrack(
    id: string,
    clips: Array<{ bufferId?: string; audioBufferId?: string }> = []
): HydratableProjectTrack {
    return {
        id,
        name: id,
        kind: 'audio',
        clips: clips.map((clip, index) => ({
            id: `${id}-clip-${index}`,
            trackId: id,
            name: `${id} clip ${index}`,
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
            bufferId: clip.bufferId,
            audioBufferId: clip.audioBufferId,
        })),
    };
}

function dataWithTracks(tracks: HydratableProjectTrack[]): HydratableProjectData {
    return {
        version: 1,
        meta: {
            name: 'test',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        arrangement: { tracks },
    };
}

describe('collectProjectAudioBufferIds', () => {
    it('returns an empty array when no tracks have buffer ids', () => {
        const result = collectProjectAudioBufferIds({ data: dataWithTracks([audioTrack('t1')]) });
        expect(result).toEqual([]);
    });

    it('collects bufferId from each clip', () => {
        const result = collectProjectAudioBufferIds({
            data: dataWithTracks([
                audioTrack('t1', [{ bufferId: 'buf-a' }]),
                audioTrack('t2', [{ bufferId: 'buf-b' }]),
            ]),
        });
        expect(result).toEqual(['buf-a', 'buf-b']);
    });

    it('falls back to legacy audioBufferId when bufferId is absent', () => {
        const result = collectProjectAudioBufferIds({
            data: dataWithTracks([audioTrack('t1', [{ audioBufferId: 'legacy-buf' }])]),
        });
        expect(result).toEqual(['legacy-buf']);
    });

    it('collects frozenBufferId from track-level field', () => {
        const track = audioTrack('t1', [{ bufferId: 'clip-buf' }]);
        track.frozenBufferId = 'frozen-buf';
        const result = collectProjectAudioBufferIds({ data: dataWithTracks([track]) });
        expect(result).toEqual(['frozen-buf', 'clip-buf']);
    });

    it('freezeState.frozenBufferId shadows track-level frozenBufferId', () => {
        const track = audioTrack('t1');
        track.frozenBufferId = 'top-level';
        track.freezeState = {
            status: 'frozen',
            frozenBufferId: 'freeze-state',
        };
        const result = collectProjectAudioBufferIds({ data: dataWithTracks([track]) });
        expect(result).toEqual(['freeze-state']);
    });

    it('collects buffer ids from track alternatives', () => {
        const track = audioTrack('t1', [{ bufferId: 'main-buf' }]);
        track.alternatives = [
            {
                id: 'alt-1',
                name: 'Alt 1',
                clips: [
                    {
                        id: 'alt-clip',
                        trackId: 't1',
                        name: 'alt clip',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'audio',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ffffff',
                        locked: false,
                        muted: false,
                        bufferId: 'alt-buf',
                    },
                ],
            },
        ];
        const result = collectProjectAudioBufferIds({ data: dataWithTracks([track]) });
        expect(result).toEqual(['main-buf', 'alt-buf']);
    });

    it('deduplicates buffer ids referenced by multiple clips', () => {
        const result = collectProjectAudioBufferIds({
            data: dataWithTracks([audioTrack('t1', [{ bufferId: 'shared-buf' }, { bufferId: 'shared-buf' }])]),
        });
        expect(result).toEqual(['shared-buf']);
    });

    it('uses the active arrangement snapshot when arrangements are present', () => {
        const data = dataWithTracks([audioTrack('top', [{ bufferId: 'top-buf' }])]);
        data.arrangements = [
            {
                id: 'arr-1',
                name: 'Arr 1',
                tracks: {
                    tracks: [audioTrack('arr-track', [{ bufferId: 'arr-buf' }])],
                    selectedTrackId: 'arr-track',
                },
            },
        ];
        data.activeArrangementId = 'arr-1';
        const result = collectProjectAudioBufferIds({ data });
        expect(result).toEqual(['arr-buf']);
    });

    it('falls back to the first arrangement when activeArrangementId does not match', () => {
        const data = dataWithTracks([audioTrack('top', [{ bufferId: 'top-buf' }])]);
        data.arrangements = [
            {
                id: 'first',
                name: 'First',
                tracks: {
                    tracks: [audioTrack('first-track', [{ bufferId: 'first-buf' }])],
                    selectedTrackId: null,
                },
            },
        ];
        data.activeArrangementId = 'missing';
        const result = collectProjectAudioBufferIds({ data });
        expect(result).toEqual(['first-buf']);
    });
});
