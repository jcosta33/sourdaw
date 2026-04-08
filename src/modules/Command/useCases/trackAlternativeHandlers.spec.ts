import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Container } from '#/infra/di/Container';
import { type Track } from '#/modules/Arrangement/models/Track';
import { handleCreateTrackAlternative } from './trackAlternativeHandlers';

function createMinimalTrack(overrides: Partial<Track> = {}): Track {
    return {
        id: 'track-1',
        name: 'T',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 48,
        outputId: 'main',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-a',
        alternatives: [{ id: 'alt-a', name: 'A', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

describe('trackAlternativeHandlers', () => {
    let randomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        Container.clear();
        randomSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('fixed-uuid');
    });

    afterEach(() => {
        randomSpy.mockRestore();
    });

    it('handleCreateTrackAlternative appends alternative and switches active', () => {
        const setTrackStoreState = vi.fn();
        const getTrackStoreState = vi.fn(() => ({
            tracks: [createMinimalTrack()],
            selectedTrackId: 'track-1',
        }));
        injectDependencies(handleCreateTrackAlternative, { getTrackStoreState, setTrackStoreState });

        handleCreateTrackAlternative({
            type: 'createTrackAlternative',
            payload: { trackId: 'track-1', name: 'Alt B', duplicateActive: false },
        });

        expect(setTrackStoreState).toHaveBeenCalledTimes(1);
        const nextState = setTrackStoreState.mock.calls[0][0];
        const updated = nextState.tracks[0];
        expect(updated.alternatives).toHaveLength(2);
        expect(updated.activeAlternativeId).toBe('alt-fixed-uuid');
        expect(updated.clips).toEqual([]);
    });
});
