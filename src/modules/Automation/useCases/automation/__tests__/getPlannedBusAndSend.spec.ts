import { beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type AppAction, type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { getPlannedBus } from '../getPlannedBus';
import { getPlannedSend } from '../getPlannedSend';

// An action neither planner lists: it must leave the plan as the live state stands.
const unlisted: AppAction = { type: 'togglePlayback' };

function restorePayload(
    row: Track,
    routingPatches: RestoreTrackPayloadSnapshot['routingPatches'] = []
): RestoreTrackPayloadSnapshot {
    return {
        trackId: row.id,
        trackSnapshot: structuredClone(row),
        trackName: row.name,
        trackKind: row.kind,
        trackGain: row.gain,
        trackParentId: row.parentId,
        trackIndex: 0,
        wasSelected: false,
        routingPatches,
        automationLaneSnapshots: [],
        clipSatellites: [],
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        takeLaneSnapshots: [],
        sidechainRouteSnapshots: [],
        ownedModulatorSnapshots: [],
        incomingModulationMappingSnapshots: [],
    };
}

const busRow = createTrack({ id: 'bus', name: 'Bus', kind: 'bus' });
const sendingTrackRow: Track = {
    ...createTrack({ id: 'track', name: 'Track', kind: 'audio' }),
    sends: [{ busId: 'bus', level: 0.25, preFader: true }],
};
const removeBus: AppAction = { type: 'removeTrack', payload: { trackId: 'bus' } };
// What captureTrackRemovalSnapshot records for the bus: the surviving track's sends before the removal.
const busRestore: AppAction = {
    type: 'restoreTrack',
    payload: restorePayload(busRow, [
        {
            trackId: 'track',
            expected: { outputId: 'master', sends: [] },
            replacement: { outputId: 'master', sends: [{ busId: 'bus', level: 0.5, preFader: false }] },
        },
    ]),
};

// A track the project holds and a restore batch does not bring back: the handler accepts a routing
// patch on it only while its live routing equals the patch's expected routing.
const survivorRow = createTrack({ id: 'survivor', name: 'Survivor', kind: 'audio' });
const survivorExpected = { outputId: survivorRow.outputId, sends: [] };
function survivorPatch(level: number, preFader = false): RestoreTrackPayloadSnapshot['routingPatches'] {
    return [
        {
            trackId: 'survivor',
            expected: survivorExpected,
            replacement: { outputId: survivorRow.outputId, sends: [{ busId: 'bus', level, preFader }] },
        },
    ];
}

describe('planned bus and send', () => {
    beforeEach(() => {
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track', name: 'Track', kind: 'audio' }),
                    sends: [{ busId: 'bus', level: 0.5, preFader: false }],
                },
                createTrack({ id: 'bus', name: 'Bus', kind: 'bus' }),
            ],
            selectedTrackId: null,
        });
    });

    it('keeps the live bus through an unlisted action and drops it once the batch removes it', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'bus' } };

        expect(getPlannedBus('bus', [unlisted])?.name).toBe('Bus');
        expect(getPlannedBus('bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a live bus once the batch discards it as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'bus' } };

        expect(getPlannedBus('bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a bus an earlier createBus mints once a later removeTrack removes it, and keeps it for another track', () => {
        const create: AppAction = { type: 'createBus', payload: { busId: 'new-bus', name: 'Verb' } };
        const removeOther: AppAction = { type: 'removeTrack', payload: { trackId: 'track' } };
        const removeBus: AppAction = { type: 'removeTrack', payload: { trackId: 'new-bus' } };

        expect(getPlannedBus('new-bus', [create, removeOther])).toMatchObject({ id: 'new-bus', name: 'Verb' });
        expect(getPlannedBus('new-bus', [create, removeBus])).toBeUndefined();
    });

    it('keeps the live bus through a removeDevice, which removes no track', () => {
        const removeDevice: AppAction = { type: 'removeDevice', payload: { deviceId: 'device-1' } };

        expect(getPlannedBus('bus', [removeDevice])?.name).toBe('Bus');
    });

    it('keeps the live send through an unlisted action and drops it once the batch removes it', () => {
        const removal: AppAction = { type: 'removeSend', payload: { trackId: 'track', busId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted])).toMatchObject({ busId: 'bus', level: 0.5 });
        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a planned send once the batch removes its source track', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'track' } };

        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a planned send once the batch removes its bus', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('keeps a planned send when the batch removes an unrelated track', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'other' } };

        expect(getPlannedSend('track', 'bus', [removal])).toMatchObject({ busId: 'bus', level: 0.5 });
    });

    it('drops a planned send once the batch discards its source track as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'track' } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once the batch discards its bus as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once a batch discard lists its source track', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other', 'track'] } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once a batch discard lists its bus', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['bus', 'other'] } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('keeps a planned send when a batch discard lists only unrelated tracks', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other', 'another'] } };

        expect(getPlannedSend('track', 'bus', [discard])).toMatchObject({ busId: 'bus', level: 0.5 });
    });

    it('drops a planned send once the batch removes every track', () => {
        const removeAll: AppAction = { type: 'removeAllTracks' };

        expect(getPlannedSend('track', 'bus', [unlisted, removeAll])).toBeUndefined();
    });

    it('plans the bus a restoreTrack brings back', () => {
        expect(getPlannedBus('bus', [removeBus])).toBeUndefined();
        expect(getPlannedBus('bus', [removeBus, busRestore])).toMatchObject({ id: 'bus', kind: 'bus', name: 'Bus' });
    });

    it('plans the send a surviving track gets back when its restored bus returns', () => {
        expect(getPlannedSend('track', 'bus', [removeBus])).toBeUndefined();
        expect(getPlannedSend('track', 'bus', [removeBus, busRestore])).toEqual({
            busId: 'bus',
            level: 0.5,
            preFader: false,
        });
    });

    it('plans the sends a restored track returns with', () => {
        const removeTrack: AppAction = { type: 'removeTrack', payload: { trackId: 'track' } };
        const restore: AppAction = { type: 'restoreTrack', payload: restorePayload(sendingTrackRow) };

        expect(getPlannedSend('track', 'bus', [removeTrack])).toBeUndefined();
        expect(getPlannedSend('track', 'bus', [removeTrack, restore])).toEqual({
            busId: 'bus',
            level: 0.25,
            preFader: true,
        });
    });

    it('plans the bus and sends a restoreTracks brings back, leaving patched siblings to their own row', () => {
        trackStore.set({ tracks: [survivorRow], selectedTrackId: null });
        // removeAllTracks puts survivor patches on the restore with the highest trackIndex.
        const restores: AppAction = {
            type: 'restoreTracks',
            payload: {
                restores: [
                    { ...restorePayload(busRow, survivorPatch(0.75)), trackIndex: 1 },
                    { ...restorePayload(sendingTrackRow), trackIndex: 0 },
                ],
            },
        };

        expect(getPlannedBus('bus', [restores])).toMatchObject({ id: 'bus', name: 'Bus' });
        expect(getPlannedSend('track', 'bus', [restores])).toEqual({ busId: 'bus', level: 0.25, preFader: true });
        expect(getPlannedSend('survivor', 'bus', [restores])).toEqual({ busId: 'bus', level: 0.75, preFader: false });
    });

    it('drops a planned send once the batch discards the imported stem set its track or bus belongs to', () => {
        const discardSource: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['track'], guards: [] },
        };
        const discardBus: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['bus'], guards: [] },
        };
        const discardFolder: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'track', stemTrackIds: ['stem'], guards: [] },
        };
        const discardOther: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['stem'], guards: [] },
        };

        expect(getPlannedSend('track', 'bus', [discardSource])).toBeUndefined();
        expect(getPlannedSend('track', 'bus', [discardBus])).toBeUndefined();
        expect(getPlannedSend('track', 'bus', [discardFolder])).toBeUndefined();
        expect(getPlannedSend('track', 'bus', [discardOther])).toMatchObject({ busId: 'bus', level: 0.5 });
    });

    it('drops a bus once the batch discards the imported stem set holding it', () => {
        const discardStem: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['bus'], guards: [] },
        };
        const discardFolder: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'bus', stemTrackIds: [], guards: [] },
        };
        const discardOther: AppAction = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['stem'], guards: [] },
        };

        expect(getPlannedBus('bus', [discardStem])).toBeUndefined();
        expect(getPlannedBus('bus', [discardFolder])).toBeUndefined();
        expect(getPlannedBus('bus', [discardOther])?.name).toBe('Bus');
    });

    it('drops a bus once the batch removes every track', () => {
        expect(getPlannedBus('bus', [unlisted, { type: 'removeAllTracks' }])).toBeUndefined();
    });

    it('drops a bus once a batch discard lists it and keeps it when the discard lists others', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other', 'bus'] } };
        const discardOthers: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other'] } };

        expect(getPlannedBus('bus', [discard])).toBeUndefined();
        expect(getPlannedBus('bus', [discardOthers])?.name).toBe('Bus');
    });

    it('keeps the send a restored track returns with over a later sibling restore patching the same track', () => {
        const patchFor = (level: number, preFader: boolean): RestoreTrackPayloadSnapshot['routingPatches'] => [
            {
                trackId: 'track',
                expected: { outputId: 'master', sends: [] },
                replacement: { outputId: 'master', sends: [{ busId: 'bus', level, preFader }] },
            },
        ];
        const restores: AppAction = {
            type: 'restoreTracks',
            payload: {
                restores: [
                    { ...restorePayload(sendingTrackRow), trackIndex: 0 },
                    { ...restorePayload(busRow, patchFor(0.75, false)), trackIndex: 1 },
                ],
            },
        };

        expect(getPlannedSend('track', 'bus', [restores])).toEqual({ busId: 'bus', level: 0.25, preFader: true });
    });

    it('applies restoreTracks patches ascending by trackIndex whatever order the payload lists them', () => {
        trackStore.set({ tracks: [survivorRow], selectedTrackId: null });
        const restores: AppAction = {
            type: 'restoreTracks',
            payload: {
                restores: [
                    { ...restorePayload(busRow, survivorPatch(0.9)), trackIndex: 1 },
                    {
                        ...restorePayload(
                            createTrack({ id: 'second', name: 'Second', kind: 'audio' }),
                            survivorPatch(0.1)
                        ),
                        trackIndex: 0,
                    },
                ],
            },
        };

        expect(getPlannedSend('survivor', 'bus', [restores])).toEqual({ busId: 'bus', level: 0.9, preFader: false });
    });

    it('plans the kind of a restored track that is not a bus', () => {
        const restore: AppAction = { type: 'restoreTrack', payload: restorePayload(sendingTrackRow) };

        expect(getPlannedBus('track', [restore])).toMatchObject({ id: 'track', kind: 'audio', name: 'Track' });
    });

    it('applies no routing patch to a track the restore names in its batch list', () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        const restoreOwner: AppAction = { type: 'restoreTrack', payload: restorePayload(sendingTrackRow) };
        const restorePatching: AppAction = {
            type: 'restoreTrack',
            payload: {
                ...restorePayload(busRow, [
                    {
                        trackId: 'track',
                        expected: { outputId: 'master', sends: [] },
                        replacement: { outputId: 'master', sends: [{ busId: 'bus', level: 0.9, preFader: false }] },
                    },
                ]),
                batchRestoreTracks: [
                    { trackId: 'track', trackIndex: 0 },
                    { trackId: 'bus', trackIndex: 1 },
                ],
            },
        };

        expect(getPlannedSend('track', 'bus', [restoreOwner, restorePatching])).toEqual({
            busId: 'bus',
            level: 0.25,
            preFader: true,
        });
    });

    it('plans a bus restored after another restore in the same restoreTracks', () => {
        const restores: AppAction = {
            type: 'restoreTracks',
            payload: {
                restores: [
                    { ...restorePayload(sendingTrackRow), trackIndex: 0 },
                    { ...restorePayload(busRow), trackIndex: 1 },
                ],
            },
        };

        expect(getPlannedBus('bus', [removeBus])).toBeUndefined();
        expect(getPlannedBus('bus', [removeBus, restores])).toMatchObject({ id: 'bus', name: 'Bus' });
    });
});
