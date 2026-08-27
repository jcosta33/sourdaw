import { afterEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

import { serializeClipScopedAutomationLanes } from '../serializeClipScopedAutomationLanes';

function lane(id: string, clipId: string | undefined): ClipAutomationLaneSnapshot {
    return {
        id,
        trackId: 'track-1',
        ...(clipId === undefined ? {} : { clipId }),
        parameterId: 'gain',
        parameterName: 'gain',
        points: [
            { id: `${id}-p1`, beat: 0, value: 0.5, curve: 'linear', tension: 0 },
            { id: `${id}-p2`, beat: 2, value: 1, curve: 'linear', tension: 0 },
        ],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function setLiveLanes(lanes: readonly ClipAutomationLaneSnapshot[]): void {
    automationStore.set({ lanes: structuredClone(lanes) as never });
}

describe('serializeClipScopedAutomationLanes', () => {
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('serializes only the lanes of the requested clip ids, in lane-id order', () => {
        // Stored out of id order with an unrelated clip's lane and a
        // track-level lane interleaved: only the requested clip's lanes appear,
        // in canonical id order.
        setLiveLanes([
            lane('lane-b', 'clip-1'),
            lane('track-lane', undefined),
            lane('lane-a', 'clip-2'),
            lane('lane-a', 'clip-1'),
        ]);

        const parsed = JSON.parse(serializeClipScopedAutomationLanes(['clip-1'])) as Array<{
            id: string;
            clipId: string;
            points: unknown[];
        }>;
        expect(parsed.map((entry) => entry.id)).toEqual(['lane-a', 'lane-b']);
        expect(parsed.every((entry) => entry.clipId === 'clip-1' && entry.points.length === 2)).toBe(true);
    });

    it('is order-insensitive: the same lanes stored in a different order serialize identically', () => {
        setLiveLanes([lane('lane-a', 'clip-1'), lane('lane-b', 'clip-1')]);
        const first = serializeClipScopedAutomationLanes(['clip-1']);

        setLiveLanes([lane('lane-b', 'clip-1'), lane('lane-a', 'clip-1')]);

        // The guard compares capture against check across an undo boundary;
        // store iteration order must never decide that comparison.
        expect(serializeClipScopedAutomationLanes(['clip-1'])).toBe(first);
    });

    it('serializes a clip with no lanes as an empty array', () => {
        setLiveLanes([lane('track-lane', undefined)]);

        expect(serializeClipScopedAutomationLanes(['clip-1'])).toBe('[]');
    });
});
