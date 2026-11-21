import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getPlannedTrackState, plannedTrackByActionType } from '../getPlannedTrackState';
import { trackCreationByActionType } from '../trackCreationByActionType';

function plan(prior: readonly AppAction[], trackId: string) {
    return getPlannedTrackState(
        { actions: [...prior, { type: 'selectTrack', payload: { trackId } }], actionIndex: prior.length },
        trackId
    );
}

describe('getPlannedTrackState', () => {
    afterEach(() => {
        trackStore.set(defaultTrackState);
    });

    it('plans a track for exactly the actions that create one', () => {
        const none = plannedTrackByActionType.selectTrack;
        const creatingEntries = Object.entries(plannedTrackByActionType).filter(([, entry]) => entry !== none);
        const creating = creatingEntries.map(([type]) => type).sort();
        expect(creating).toEqual(['addTrack', 'createBus', 'createFolder', 'duplicateTrack', 'restoreTrack']);
        const classifiedEntries = Object.entries(trackCreationByActionType).filter(
            ([, creation]) => creation === 'planned'
        );
        const classifiedPlanned = classifiedEntries.map(([type]) => type).sort();
        expect(classifiedPlanned).toEqual(creating);
    });

    it('plans a track an earlier restoreTrack restores from its snapshot, through the actions after it', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 }), height: 120 }],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        trackStore.set(defaultTrackState);
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }

        const planned = plan(
            [
                { type: 'restoreTrack', payload: snapshot },
                { type: 'setTrackHeight', payload: { trackId: 'gone', height: 200 } },
            ],
            'gone'
        );

        expect(planned).toMatchObject({ id: 'gone', name: 'Gone', gain: 0.5, height: 200 });
    });

    it('plans a track an earlier removeTrack removes as no track, and plans it again once restored', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 }), height: 120 }],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }
        const remove = { type: 'removeTrack', payload: { trackId: 'gone' } } as const;
        const restore = { type: 'restoreTrack', payload: snapshot } as const;

        expect(plan([], 'gone')).toMatchObject({ id: 'gone', height: 120 });
        expect(plan([remove], 'gone')).toBeNull();
        expect(plan([remove, restore], 'gone')).toMatchObject({ id: 'gone', height: 120 });
        expect(plan([remove, restore, remove], 'gone')).toBeNull();
    });

    it('keeps a duplicate at the default height a new track has, whatever its source held or an edit after the duplicate gives the source', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'source', name: 'Source', kind: 'audio', gain: 0.5 }), height: 120 }],
        });

        const planned = plan(
            [
                { type: 'duplicateTrack', payload: { trackId: 'source', targetTrackId: 'copy' } },
                { type: 'setTrackHeight', payload: { trackId: 'source', height: 150 } },
            ],
            'copy'
        );

        expect(planned?.height).toBe(80);
    });

    it('gives a duplicated hosted plugin a planned instance id of its own and any other device none', () => {
        const base = createTrack({ id: 'source', name: 'Source', kind: 'audio', gain: 0.5 });
        trackStore.set({
            ...defaultTrackState,
            tracks: [
                {
                    ...base,
                    devices: [
                        {
                            id: 'd-plugin',
                            name: 'Plugin',
                            type: 'external-plugin',
                            bypassed: false,
                            parameterValues: {},
                            externalPluginId: 'plug',
                            externalInstanceId: 'inst-src',
                        },
                        {
                            id: 'd-builtin',
                            name: 'Builtin',
                            type: 'eq',
                            bypassed: false,
                            parameterValues: {},
                            externalInstanceId: 'stale',
                        },
                    ],
                },
            ],
        });

        const planned = plan(
            [{ type: 'duplicateTrack', payload: { trackId: 'source', targetTrackId: 'copy' } }],
            'copy'
        );

        expect(planned?.devices[0]?.externalInstanceId).toBeDefined();
        expect(planned?.devices[0]?.externalInstanceId).not.toBe('inst-src');
        expect(planned?.devices[1]?.externalInstanceId).toBeUndefined();
    });

    it('plans no copy of a source that does not exist', () => {
        expect(
            plan([{ type: 'duplicateTrack', payload: { trackId: 'nope', targetTrackId: 'copy' } }], 'copy')
        ).toBeNull();
    });

    it('does not plan a restore for another track', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 })],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        trackStore.set(defaultTrackState);
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }

        expect(plan([{ type: 'restoreTrack', payload: snapshot }], 'other')).toBeNull();
    });

    it('plans a folder an earlier createFolder creates, under its payload id', () => {
        const planned = plan([{ type: 'createFolder', payload: { name: 'Drums', folderTrackId: 'folder' } }], 'folder');

        expect(planned).toMatchObject({ id: 'folder', kind: 'folder', name: 'Drums' });
        expect(plan([{ type: 'createFolder', payload: { name: 'Drums' } }], 'folder')).toBeNull();
    });

    it('plans a duplicate as its source stands before it, copied under the target id', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'source', name: 'Source', kind: 'audio', gain: 0.5 }), height: 120 }],
        });

        const planned = plan(
            [
                { type: 'setTrackHeight', payload: { trackId: 'source', height: 150 } },
                { type: 'duplicateTrack', payload: { trackId: 'source', targetTrackId: 'copy' } },
                { type: 'setTrackHeight', payload: { trackId: 'copy', height: 200 } },
            ],
            'copy'
        );

        expect(planned).toMatchObject({ id: 'copy', gain: 0.5, height: 200 });
        expect(
            plan(
                [
                    { type: 'setTrackHeight', payload: { trackId: 'source', height: 150 } },
                    { type: 'duplicateTrack', payload: { trackId: 'source', targetTrackId: 'copy' } },
                ],
                'copy'
            )?.height
        ).toBe(80);
        expect(plan([{ type: 'duplicateTrack', payload: { trackId: 'source' } }], 'copy')).toBeNull();
    });

    it('plans a duplicate of a hidden, tall source as the shown, default-height copy the duplicate executes', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [
                {
                    ...createTrack({ id: 'source', name: 'Source', kind: 'audio', gain: 0.5 }),
                    hidden: true,
                    collapsed: true,
                    height: 200,
                    muted: true,
                    pan: -0.25,
                    notes: 'kept',
                },
            ],
        });

        const planned = plan(
            [{ type: 'duplicateTrack', payload: { trackId: 'source', targetTrackId: 'copy' } }],
            'copy'
        );

        expect(planned).toMatchObject({
            id: 'copy',
            name: 'Source (copy)',
            kind: 'audio',
            hidden: false,
            collapsed: false,
            height: 80,
            muted: false,
            gain: 0.5,
            pan: -0.25,
            notes: 'kept',
        });
    });

    it('plans no copy of a master track', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'master', name: 'Master', kind: 'master' })],
        });

        expect(
            plan([{ type: 'duplicateTrack', payload: { trackId: 'master', targetTrackId: 'copy' } }], 'copy')
        ).toBeNull();
    });

    it('plans a created track only through the actions after its creator, not the project-wide edits before it', () => {
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 20 } } as const;
        const add = { type: 'addTrack', payload: { id: 'new', kind: 'audio', name: 'New' } } as const;

        expect(plan([zoom, add], 'new')?.height).toBe(80);
        expect(plan([zoom, add, zoom], 'new')?.height).toBe(100);
    });

    it('plans a created folder and a restored track only through the actions after their creator', () => {
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 20 } } as const;
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 }), height: 120 }],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        trackStore.set(defaultTrackState);
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }

        expect(
            plan([zoom, { type: 'createFolder', payload: { name: 'F', folderTrackId: 'folder' } }, zoom], 'folder')
                ?.height
        ).toBe(100);
        expect(plan([zoom, { type: 'restoreTrack', payload: snapshot }, zoom], 'gone')?.height).toBe(140);
    });

    it('plans a created bus only through the actions after its creator', () => {
        const zoom = { type: 'zoomTracksVertical', payload: { delta: 20 } } as const;
        const bus = { type: 'createBus', payload: { busId: 'bus', name: 'Verb' } } as const;

        expect(plan([zoom, bus], 'bus')?.height).toBe(80);
        expect(plan([zoom, bus, zoom], 'bus')?.height).toBe(100);
    });

    it('plans a track an earlier addTrack creates, under its name and gain', () => {
        const planned = plan([{ type: 'addTrack', payload: { id: 'new', kind: 'audio', name: 'Drums' } }], 'new');
        expect(planned).toMatchObject({ id: 'new', kind: 'audio', name: 'Drums', gain: 0.8 });
    });

    it('never plans a master track from addTrack', () => {
        expect(plan([{ type: 'addTrack', payload: { id: 'new', kind: 'master' } }], 'new')).toBeNull();
    });

    it('plans a bus an earlier createBus creates, at its initial gain', () => {
        const planned = plan([{ type: 'createBus', payload: { busId: 'bus', name: 'Verb', initialGain: 0.5 } }], 'bus');
        expect(planned).toMatchObject({ id: 'bus', kind: 'bus', name: 'Verb', gain: 0.5 });
    });

    it('names a nameless addTrack by the default its position in the batch earns', () => {
        const prior: AppAction[] = [{ type: 'addTrack', payload: { id: 'first', kind: 'audio' } }];
        const first = plan(prior, 'first');
        const second = plan([...prior, { type: 'addTrack', payload: { id: 'second', kind: 'audio' } }], 'second');
        expect(first?.name).toBe('Audio 1');
        expect(second?.name).toBe('Audio 2');
    });

    it('plans an addTrack under the default gain and carries its parent and output', () => {
        const planned = plan(
            [
                {
                    type: 'addTrack',
                    payload: { id: 'new', kind: 'audio', name: 'A', parentId: 'folder', outputId: 'out' },
                },
            ],
            'new'
        );
        expect(planned).toMatchObject({ gain: 0.8, parentId: 'folder', outputId: 'out' });
    });

    it('plans a createBus without an initial gain at the default gain', () => {
        const planned = plan([{ type: 'createBus', payload: { busId: 'bus', name: 'Verb' } }], 'bus');
        expect(planned).toMatchObject({ id: 'bus', kind: 'bus', name: 'Verb', gain: 0.8 });
    });

    it('plans nothing for a bus id no earlier createBus creates', () => {
        expect(plan([{ type: 'createBus', payload: { busId: 'other', name: 'Verb' } }], 'bus')).toBeNull();
    });

    it('plans nothing for an id no earlier action creates', () => {
        expect(plan([{ type: 'addTrack', payload: { id: 'other', kind: 'audio' } }], 'new')).toBeNull();
    });

    it('projects a live track through the prior actions', () => {
        trackStore.set({ ...defaultTrackState, tracks: [createTrack({ id: 'live', kind: 'audio', name: 'Live' })] });
        const planned = plan([{ type: 'renameTrack', payload: { trackId: 'live', name: 'Renamed' } }], 'live');
        expect(planned?.name).toBe('Renamed');
    });
});
