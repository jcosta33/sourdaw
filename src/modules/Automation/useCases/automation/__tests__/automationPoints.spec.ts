import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationPoint } from '../../../models/Automation';
import { addAutomationPoint } from '../addAutomationPoint';
import { getAutomationValueAtBeat } from '../getAutomationValueAtBeat';
import { quantizeAutomationBeats } from '../quantizeAutomationBeats';
import { removeAutomationPoint } from '../removeAutomationPoint';
import { updateAutomationPoint } from '../updateAutomationPoint';

const mocks = vi.hoisted(() => ({
    automationStoreValue: { value: { lanes: [] } },
    automationStoreSet: vi.fn(),
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
        set: mocks.automationStoreSet,
    },
}));

describe('Automation Point Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = { lanes: [] };
    });

    it('addAutomationPoint adds and sorts points', () => {
        mocks.automationStoreValue.value = {
            lanes: [{ id: 'l1', points: [{ beat: 10, value: 0.5 }] }],
        } as any;

        addAutomationPoint('l1', { beat: 5, value: 0.2, curve: 'linear', tension: 0 });

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        });
    });

    it('removeAutomationPoint removes point at beat', () => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        } as any;

        removeAutomationPoint('l1', 5);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [{ id: 'l1', points: [{ beat: 10, value: 0.5 }] }],
        });
    });

    it('updateAutomationPoint changes value and optionally beat', () => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        } as any;

        updateAutomationPoint('l1', 5, 0.8, 6);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 6, value: 0.8 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        });
    });

    it('updateAutomationPoint matches a near-beat (pixel round-trip) by tolerance', () => {
        mocks.automationStoreValue.value = {
            lanes: [{ id: 'l1', points: [{ beat: 5, value: 0.2 }] }],
        } as any;

        // 5.02 never equals the stored 5 under `===`, but sits inside the 0.05
        // match window, so the edit must land on the existing point — not no-op.
        updateAutomationPoint('l1', 5.02, 0.9);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [{ id: 'l1', points: [{ beat: 5, value: 0.9 }] }],
        });
    });

    describe('getAutomationValueAtBeat', () => {
        it('returns first point value if beat is before all points', () => {
            const points = [
                { beat: 5, value: 0.2 },
                { beat: 10, value: 0.5 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            expect(getAutomationValueAtBeat('l1', 0)).toBe(0.2);
        });

        it('returns last point value if beat is after all points', () => {
            const points = [
                { beat: 5, value: 0.2 },
                { beat: 10, value: 0.5 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            expect(getAutomationValueAtBeat('l1', 20)).toBe(0.5);
        });

        it('interpolates between points', () => {
            const points = [
                { beat: 5, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 10, value: 0.5, curve: 'linear', tension: 0 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            const val = getAutomationValueAtBeat('l1', 7.5);

            expect(val).toBe(0.35);
        });

        it('uses interior neighbors for a smooth multi-point lane', () => {
            const points = [
                { beat: 0, value: -10, curve: 'linear', tension: 0 },
                { beat: 4, value: 2, curve: 'smooth', tension: 0 },
                { beat: 8, value: 8, curve: 'linear', tension: 0 },
                { beat: 12, value: 20, curve: 'linear', tension: 0 },
            ];
            mocks.automationStoreValue.value = {
                lanes: [{ id: 'l1', points, minValue: -20, maxValue: 30 }],
            } as any;

            // Catmull-Rom with both neighbors yields 3.78125. Omitting them
            // yields 3.21875, while linear interpolation yields 3.5.
            expect(getAutomationValueAtBeat('l1', 5)).toBeCloseTo(3.78125, 5);
        });

        it('returns null when a linked lane has an empty source (no local fall-through)', () => {
            const localPoints = [
                { beat: 0, value: 0.1 },
                { beat: 10, value: 0.9 },
            ];
            mocks.automationStoreValue.value = {
                lanes: [
                    { id: 'follower', points: localPoints, linkedLaneId: 'source' },
                    { id: 'source', points: [] },
                ],
            } as any;

            // The follower must report null (its empty source is authoritative),
            // never silently sample its own localPoints.
            expect(getAutomationValueAtBeat('follower', 5)).toBeNull();
        });

        it('returns null (not a real 0) when linked lanes form a cycle', () => {
            // A→B→A. The cycle guard must report "no value" (null) like every
            // other no-value path, so the scheduler skips the lane and leaves the
            // param untouched — a hard 0 would drive the param to a real zero.
            mocks.automationStoreValue.value = {
                lanes: [
                    { id: 'A', points: [{ beat: 0, value: 0.7 }], linkedLaneId: 'B' },
                    { id: 'B', points: [{ beat: 0, value: 0.3 }], linkedLaneId: 'A' },
                ],
            } as any;

            expect(getAutomationValueAtBeat('A', 5)).toBeNull();
        });

        it('returns null (not a real 0) when a lane links to itself', () => {
            mocks.automationStoreValue.value = {
                lanes: [{ id: 'A', points: [{ beat: 0, value: 0.7 }], linkedLaneId: 'A' }],
            } as any;

            expect(getAutomationValueAtBeat('A', 5)).toBeNull();
        });
    });

    describe('quantizeAutomationBeats grid guard', () => {
        it('leaves points untouched for gridSize 0 instead of collapsing to a NaN point', () => {
            const points = [
                { beat: 1.1, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 2.7, value: 0.6, curve: 'linear', tension: 0 },
                { beat: 3.9, value: 0.9, curve: 'linear', tension: 0 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            quantizeAutomationBeats('l1', 0);

            // gridSize 0 would make Math.round(beat / 0) === NaN for every point,
            // and a Map keyed on NaN keeps a single entry — the whole lane would
            // collapse to one NaN-beat point. The guard must short-circuit before
            // touching the store.
            expect(mocks.automationStoreSet).not.toHaveBeenCalled();
        });

        it('quantizes points for a positive grid', () => {
            const points = [{ beat: 1.1, value: 0.2, curve: 'linear', tension: 0 }];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            quantizeAutomationBeats('l1', 1);

            const arg = mocks.automationStoreSet.mock.calls[0]![0] as { lanes: { points: AutomationPoint[] }[] };
            expect(arg.lanes[0]!.points[0]!.beat).toBe(1);
        });
    });

    describe('interpolateAutomationPointValue bezier (real algorithm)', () => {
        it('uses cp1/cp2 instead of falling through to linear', async () => {
            // The module is mocked at file scope for the use-case tests; pull the
            // real implementation to exercise the bezier branch directly.
            const { interpolateAutomationPointValue } = await vi.importActual<
                typeof import('../../../services/automationPointAlgorithms')
            >('../../../services/automationPointAlgorithms');

            const firstPoint: AutomationPoint = {
                beat: 0,
                value: 0,
                curve: 'bezier',
                tension: 0,
                cp1: { x: 0.25, y: 0.9 },
                cp2: { x: 0.75, y: 0.9 },
            };
            const secondPoint: AutomationPoint = { beat: 4, value: 1, curve: 'linear', tension: 0 };

            const midBezier = interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 });
            const midLinear = 0.5; // a linear fall-through would return exactly t = 0.5

            // Control points pulled toward 0.9 bow the curve above the straight
            // line, so the bezier value at the midpoint must exceed the linear one.
            expect(midBezier).toBeGreaterThan(midLinear);
            // Endpoints are still pinned to the point values.
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 0 })).toBeCloseTo(0, 6);
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 4 })).toBeCloseTo(1, 6);
        });
    });
});
