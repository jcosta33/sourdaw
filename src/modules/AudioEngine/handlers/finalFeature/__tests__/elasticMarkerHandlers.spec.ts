import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { elasticAudioStore, defaultElasticAudioState } from '#/modules/ElasticAudio/stores';

import { handleElasticRemoveMarker } from '../handleElasticRemoveMarker';
import { handleElasticToggleMarkerLock } from '../handleElasticToggleMarkerLock';

const mocks = vi.hoisted(() => ({
    removeMarker: vi.fn(),
    toggleMarkerLock: vi.fn(),
}));

vi.mock('#/modules/ElasticAudio/useCases', () => ({
    removeMarker: mocks.removeMarker,
    toggleMarkerLock: mocks.toggleMarkerLock,
}));

// #5570 — warp-marker identity is clip-local, so the typed routes target the
// clip open in the elastic editor rather than scanning for the first matching
// marker id across the store.
describe('Elastic marker handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        elasticAudioStore.set(defaultElasticAudioState);
    });

    afterEach(() => {
        elasticAudioStore.set(defaultElasticAudioState);
    });

    it('handleElasticRemoveMarker delegates to the open clip as owner', () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-b' });

        void handleElasticRemoveMarker.execute({ type: 'elasticRemoveMarker', payload: { markerId: 'm-1' } });

        expect(mocks.removeMarker).toHaveBeenCalledWith('clip-b', 'm-1');
    });

    it('handleElasticToggleMarkerLock delegates to the open clip as owner', () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-b' });

        void handleElasticToggleMarkerLock.execute({ type: 'elasticToggleMarkerLock', payload: { markerId: 'm-1' } });

        expect(mocks.toggleMarkerLock).toHaveBeenCalledWith('clip-b', 'm-1');
    });

    it('neither handler edits anything with no clip open', () => {
        void handleElasticRemoveMarker.execute({ type: 'elasticRemoveMarker', payload: { markerId: 'm-1' } });
        void handleElasticToggleMarkerLock.execute({ type: 'elasticToggleMarkerLock', payload: { markerId: 'm-1' } });

        expect(mocks.removeMarker).not.toHaveBeenCalled();
        expect(mocks.toggleMarkerLock).not.toHaveBeenCalled();
    });
});
