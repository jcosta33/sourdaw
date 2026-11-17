import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../stores/trackStore';
import { handleLoadTrackTemplate } from '../handleLoadTrackTemplate';

const mocks = vi.hoisted(() => ({
    loadTrackTemplate: vi.fn(),
    getTrackStoreState: vi.fn(),
    captureTrackRemovalSnapshot: vi.fn(),
}));

vi.mock('../../../useCases/loadTrackTemplate', () => ({
    loadTrackTemplate: mocks.loadTrackTemplate,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/captureTrackRemovalSnapshot', () => ({
    captureTrackRemovalSnapshot: mocks.captureTrackRemovalSnapshot,
}));

describe('handleLoadTrackTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.captureTrackRemovalSnapshot.mockImplementation((trackId: string) => ({ trackId }));
    });

    it('executes loadTrackTemplate', () => {
        void handleLoadTrackTemplate.execute({
            type: 'loadTrackTemplate',
            payload: { templateId: 'tmpl-1' },
        });

        expect(mocks.loadTrackTemplate).toHaveBeenCalledWith('tmpl-1');
    });

    it('provides a description', () => {
        const desc = handleLoadTrackTemplate.describe({
            type: 'loadTrackTemplate',
            payload: { templateId: '' },
        });
        expect(desc.label).toBe('Load Track Template');
    });

    /** The store before the load holds `existing`; the load appends `created`. */
    function appendOnLoad(created: readonly Track[]): void {
        let tracks: readonly Track[] = [TrackDummy.create({ id: 'existing', name: 'Existing', kind: 'audio' })];
        mocks.getTrackStoreState.mockImplementation(() => ({ tracks }));
        mocks.loadTrackTemplate.mockImplementation(() => {
            tracks = [...tracks, ...created];
        });
    }

    it('records exactly the ids the template appended, diffing the track store around execute', () => {
        const created = [
            TrackDummy.create({ id: 'created-1', name: 'Lead', kind: 'audio' }),
            TrackDummy.create({ id: 'created-2', name: 'Pad', kind: 'audio' }),
        ];
        appendOnLoad(created);

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'tmpl-1' } };

        const desc = handleLoadTrackTemplate.describe(action);
        const result = handleLoadTrackTemplate.execute(action);

        expect(result).toEqual({ status: 'written' });
        // One guard per created track, fingerprinting the committed row (issue #6817).
        expect(desc.inverseAction).toEqual({
            type: 'discardCreatedTracks',
            payload: {
                trackIds: ['created-1', 'created-2'],
                generatedMidiStateGuards: created.map((track) => ({
                    trackId: track.id,
                    generatedMidiStateGuard: expect.objectContaining({ entityJson: JSON.stringify(track) }),
                })),
            },
        });
        // Redo restores those exact ids instead of replaying the template, which mints
        // fresh ones and would strand the inverse above on ids nothing holds.
        expect(desc.redoAction).toEqual({
            type: 'restoreTracks',
            payload: { restores: [{ trackId: 'created-1' }, { trackId: 'created-2' }] },
        });
    });

    it('emits neither inverse nor redo when a created track could not be snapshotted', async () => {
        appendOnLoad([TrackDummy.create({ id: 'created-1', name: 'Lead', kind: 'audio' })]);
        mocks.captureTrackRemovalSnapshot.mockReturnValue(null);

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'tmpl-1' } };

        const desc = handleLoadTrackTemplate.describe(action);
        await handleLoadTrackTemplate.execute(action);

        expect(desc.inverseAction).toBeNull();
        expect(desc.redoAction).toBeUndefined();
    });

    it('emits no inverse and reports no-write when the template appends nothing', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'existing' }] });

        const action = { type: 'loadTrackTemplate' as const, payload: { templateId: 'missing-template' } };

        const desc = handleLoadTrackTemplate.describe(action);
        const result = handleLoadTrackTemplate.execute(action);

        expect(result).toEqual({ status: 'no-write' });
        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleLoadTrackTemplate.undoable).toBe(true);
    });
});
