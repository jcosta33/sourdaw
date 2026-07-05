import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import {
    defaultTakeLaneStoreState,
    sanitize_take_lane_store_state,
    takeLaneStore,
    type TakeLaneStoreState,
} from '../takeLaneStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};
let mutation_count = 0;

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutation_count += 1;
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

describe('sanitize_take_lane_store_state', () => {
    it('should reset malformed persisted take-lane state', () => {
        expect(sanitize_take_lane_store_state('corrupt')).toEqual(defaultTakeLaneStoreState);
    });

    it('should preserve valid lane rows', () => {
        const valid_state = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    automationLaneId: 'automation-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Lead',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take-1' }],
                },
            ],
        } satisfies TakeLaneStoreState;

        expect(sanitize_take_lane_store_state(valid_state)).toEqual(valid_state);
    });

    it('should drop malformed lane, take, and comp-region rows', () => {
        const valid_lane = {
            id: 'lane-1',
            trackId: 'track-1',
            takes: [
                {
                    id: 'take-1',
                    clipId: 'clip-1',
                    name: 'Good',
                    startBeat: 0,
                    endBeat: 4,
                    selected: true,
                },
                {
                    id: 'bad-take-range',
                    clipId: 'clip-2',
                    name: 'Bad',
                    startBeat: 8,
                    endBeat: 4,
                    selected: false,
                },
                {
                    id: 'bad-take-beat',
                    clipId: 'clip-3',
                    name: 'Bad',
                    startBeat: Number.NaN,
                    endBeat: 8,
                    selected: false,
                },
            ],
            activeCompRegions: [
                { startBeat: 0, endBeat: 2, takeId: 'take-1' },
                { startBeat: -1, endBeat: 2, takeId: 'take-1' },
                { startBeat: 3, endBeat: 2, takeId: 'take-1' },
                { startBeat: 4, endBeat: Number.POSITIVE_INFINITY, takeId: 'take-1' },
            ],
        };

        expect(
            sanitize_take_lane_store_state({
                lanes: [
                    valid_lane,
                    {
                        id: 'bad-lane',
                        trackId: 7,
                        takes: [],
                        activeCompRegions: [],
                    },
                ],
            })
        ).toEqual({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Good',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take-1' }],
                },
            ],
        });
    });

    it('should drop comp regions that target dropped or missing takes', () => {
        expect(
            sanitize_take_lane_store_state({
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        takes: [
                            {
                                id: 'take-1',
                                clipId: 'clip-1',
                                name: 'Good',
                                startBeat: 0,
                                endBeat: 4,
                                selected: true,
                            },
                            {
                                id: 'bad-take',
                                clipId: 'clip-2',
                                name: 'Bad',
                                startBeat: 4,
                                endBeat: Number.NaN,
                                selected: false,
                            },
                        ],
                        activeCompRegions: [
                            { startBeat: 0, endBeat: 1, takeId: 'take-1' },
                            { startBeat: 1, endBeat: 2, takeId: 'missing-take' },
                            { startBeat: 2, endBeat: 3, takeId: 'bad-take' },
                        ],
                    },
                ],
            })
        ).toEqual({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Good',
                            startBeat: 0,
                            endBeat: 4,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 1, takeId: 'take-1' }],
                },
            ],
        });
    });

    it('should sort comp regions and drop overlapping regions after the first valid interval', () => {
        expect(
            sanitize_take_lane_store_state({
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        takes: [
                            {
                                id: 'take-1',
                                clipId: 'clip-1',
                                name: 'Good',
                                startBeat: 0,
                                endBeat: 8,
                                selected: true,
                            },
                        ],
                        activeCompRegions: [
                            { startBeat: 4, endBeat: 6, takeId: 'take-1' },
                            { startBeat: 0, endBeat: 3, takeId: 'take-1' },
                            { startBeat: 2, endBeat: 5, takeId: 'take-1' },
                        ],
                    },
                ],
            })
        ).toEqual({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Good',
                            startBeat: 0,
                            endBeat: 8,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 3, takeId: 'take-1' },
                        { startBeat: 4, endBeat: 6, takeId: 'take-1' },
                    ],
                },
            ],
        });
    });

    it('should strip unknown fields from state, lanes, takes, and comp regions', () => {
        expect(
            sanitize_take_lane_store_state({
                lanes: [
                    {
                        id: 'lane-1',
                        trackId: 'track-1',
                        takes: [
                            {
                                id: 'take-1',
                                clipId: 'clip-1',
                                name: 'Good',
                                startBeat: 0,
                                endBeat: 4,
                                selected: false,
                                stale: true,
                            },
                        ],
                        activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take-1', stale: true }],
                        stale: true,
                    },
                ],
                stale: true,
            })
        ).toEqual({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-1',
                            name: 'Good',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take-1' }],
                },
            ],
        });
    });

    it('should preserve string automationLaneId and drop lanes with malformed automationLaneId', () => {
        expect(
            sanitize_take_lane_store_state({
                lanes: [
                    {
                        id: 'automation-lane',
                        trackId: 'track-1',
                        automationLaneId: 'automation-1',
                        takes: [],
                        activeCompRegions: [],
                    },
                    {
                        id: 'bad-automation-lane',
                        trackId: 'track-2',
                        automationLaneId: 42,
                        takes: [],
                        activeCompRegions: [],
                    },
                ],
            })
        ).toEqual({
            lanes: [
                {
                    id: 'automation-lane',
                    trackId: 'track-1',
                    automationLaneId: 'automation-1',
                    takes: [],
                    activeCompRegions: [],
                },
            ],
        });
    });
});

describe('takeLaneStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        takeLaneStore.set(defaultTakeLaneStoreState);
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed CRDT hydration to an empty take-lane store without throwing', () => {
        fake_doc.takeLanes = { lanes: 'not-an-array' };

        expect(() => {
            takeLaneStore.hydrate();
        }).not.toThrow();

        expect(takeLaneStore.value).toEqual(defaultTakeLaneStoreState);
    });

    it('should preserve valid CRDT hydration without writing back', async () => {
        const valid_state = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [],
                    activeCompRegions: [],
                },
            ],
        } satisfies TakeLaneStoreState;
        fake_doc.takeLanes = valid_state;

        takeLaneStore.hydrate();
        await flush_pending_frame();

        expect(takeLaneStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });
});
