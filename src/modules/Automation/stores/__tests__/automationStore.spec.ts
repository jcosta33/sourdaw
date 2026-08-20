import { afterEach, describe, it, expect, beforeEach } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { batchAddAutomationPoints } from '../../useCases/automation/batchAddAutomationPoints';
import { type AutomationStoreState } from '../automationStore';
import { automationStore, sanitize_automation_store_state } from '../automationStore';

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

describe('automationStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        automationStore.set({ lanes: [] });
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should have initial empty state', () => {
        expect(automationStore.value?.lanes).toHaveLength(0);
    });

    it('should store automation lanes', () => {
        const lane = {
            id: 'l1',
            trackId: 't1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };
        automationStore.set({ lanes: [lane] });

        expect(automationStore.value?.lanes).toHaveLength(1);
        expect(automationStore.value?.lanes[0]).toEqual(lane);
    });

    it('should sanitize malformed CRDT hydration to an empty automation store without throwing', () => {
        fake_doc.automation = { lanes: 'not-an-array' };

        expect(() => {
            automationStore.hydrate();
        }).not.toThrow();

        expect(automationStore.value).toEqual({ lanes: [] });
    });

    it('should reject sparse top-level lanes from the exact path and sanitize hydration', () => {
        const lanes: unknown[] = [];
        lanes.length = 1;
        const sparse_state = { lanes };

        const sanitized_state = sanitize_automation_store_state(sparse_state);

        expect(sanitized_state).not.toBe(sparse_state);
        expect(sanitized_state).toEqual({ lanes: [] });

        fake_doc.automation = sparse_state;

        automationStore.hydrate();

        expect(automationStore.value).toEqual({ lanes: [] });
    });

    it('should keep valid neighboring lanes and points when malformed CRDT rows hydrate', () => {
        const valid_lane = {
            id: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [
                { id: 'point-1', beat: 0, value: 0.75, curve: 'linear', tension: 0 },
                { beat: Number.NaN, value: 0.5, curve: 'linear', tension: 0 },
            ],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        } satisfies AutomationStoreState['lanes'][number];

        fake_doc.automation = {
            lanes: [
                valid_lane,
                {
                    id: 'bad-lane',
                    trackId: 7,
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };

        automationStore.hydrate();

        expect(automationStore.value).toEqual({
            lanes: [
                {
                    ...valid_lane,
                    points: [{ id: 'point-1', beat: 0, value: 0.75, curve: 'linear', tension: 0 }],
                },
            ],
        });
    });

    it('should preserve automation parents when optional nested fields are malformed', () => {
        fake_doc.automation = {
            lanes: [
                {
                    id: 'lane-with-bad-optionals',
                    trackId: 'track-1',
                    clipId: null,
                    clipAutomationMode: 'bogus',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        {
                            beat: 0,
                            value: 0.75,
                            curve: 'linear',
                            tension: 0,
                            cp1: { x: Number.NaN, y: 0.2 },
                            cp2: { x: 0.8, y: 0.9 },
                        },
                    ],
                    objects: [
                        {
                            id: 'object-1',
                            laneId: 'lane-with-bad-optionals',
                            startBeat: 0,
                            endBeat: 8,
                            points: [
                                { beat: 1, value: 0.2, curve: 'linear', tension: 0 },
                                { beat: 2, value: Number.NaN, curve: 'linear', tension: 0 },
                            ],
                            name: 'Object',
                            loopLength: null,
                        },
                    ],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                    trimPoints: 'bad-trim',
                    ghostPoints: [{ beat: 3, value: 0.4, curve: 'step', tension: 0 }],
                    linkedLaneId: null,
                    linkScale: 'bad-scale',
                    viewMinValue: 'bad-view-min',
                    viewMaxValue: 2,
                    color: 7,
                },
            ],
        };

        automationStore.hydrate();

        expect(automationStore.value).toEqual({
            lanes: [
                {
                    id: 'lane-with-bad-optionals',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 0, value: 0.75, curve: 'linear', tension: 0, cp2: { x: 0.8, y: 0.9 } }],
                    objects: [
                        {
                            id: 'object-1',
                            laneId: 'lane-with-bad-optionals',
                            startBeat: 0,
                            endBeat: 8,
                            points: [{ beat: 1, value: 0.2, curve: 'linear', tension: 0 }],
                            name: 'Object',
                        },
                    ],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                    ghostPoints: [{ beat: 3, value: 0.4, curve: 'step', tension: 0 }],
                    viewMaxValue: 2,
                },
            ],
        });
    });

    it('should sort out-of-order points ascending by beat through the real inbound sanitizer', () => {
        // Every field on every point below is individually valid and
        // exact-shaped — this is what an ordinary project file, a legacy
        // import, or a same-schema peer's CRDT sync patch looks like. Only
        // the array ORDER is wrong, which the binary searches in
        // `addAutomationPoint.ts` and `batchAddAutomationPoints.ts` require
        // to be ascending. This must not take a shortcut that skips
        // normalization just because every element already validates.
        fake_doc.automation = {
            lanes: [
                {
                    id: 'lane-unsorted',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 5, value: 0.5, curve: 'linear', tension: 0 },
                        { beat: 1, value: 0.1, curve: 'linear', tension: 0 },
                        { beat: 3, value: 0.3, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };

        automationStore.hydrate();

        const lane = automationStore.value?.lanes.find((entry) => entry.id === 'lane-unsorted');
        expect(lane?.points.map((point) => point.beat)).toEqual([1, 3, 5]);
    });

    it('merges correctly with batchAddAutomationPoints after a lane arrives out of order via hydration', () => {
        // Distinct id and values from the previous test's fixture — hydrate()
        // memoizes the last-hydrated document JSON to skip redundant work, so
        // reusing an identical payload here would short-circuit as "unchanged"
        // and hide this test's own hydrate behind the previous test's cache.
        fake_doc.automation = {
            lanes: [
                {
                    id: 'lane-unsorted-2',
                    trackId: 'track-2',
                    parameterId: 'pan',
                    parameterName: 'Pan',
                    points: [
                        { beat: 8, value: 0.8, curve: 'linear', tension: 0 },
                        { beat: 4, value: 0.4, curve: 'linear', tension: 0 },
                        { beat: 6, value: 0.6, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };

        automationStore.hydrate();

        // If the store had handed back the unsorted array verbatim, the
        // binary search inside `batchAddAutomationPoints` would search
        // against a sequence that is not actually ascending and could
        // insert `beat: 5` at the wrong slot (or miss an epsilon match).
        batchAddAutomationPoints('lane-unsorted-2', [{ beat: 5, value: 0.5, curve: 'linear', tension: 0 }]);

        const lane = automationStore.value?.lanes.find((entry) => entry.id === 'lane-unsorted-2');
        expect(lane?.points.map((point) => point.beat)).toEqual([4, 5, 6, 8]);
    });

    it('should preserve valid CRDT hydration without writing back', async () => {
        const valid_state = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-1', beat: 4, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        } satisfies AutomationStoreState;
        fake_doc.automation = valid_state;

        automationStore.hydrate();
        await flush_pending_frame();

        expect(automationStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });
});
