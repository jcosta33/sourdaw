import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { type AutomationPointSnapshot, type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

import { applyClipAutomationLaneTransition } from '../applyClipAutomationLaneTransition';

function lane(
    id: string,
    clipId: string,
    points: readonly AutomationPointSnapshot[] = [{ id: 'p1', beat: 0, value: 0.5, curve: 'linear', tension: 0 }]
): ClipAutomationLaneSnapshot {
    return {
        id,
        trackId: 'track-1',
        clipId,
        parameterId: 'gain',
        parameterName: 'gain',
        points,
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

function liveLaneIds(): string[] {
    return (automationStore.value?.lanes ?? []).map((live) => live.id);
}

describe('applyClipAutomationLaneTransition', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('re-keys a clip-scoped lane onto the replacement clip id', () => {
        const before = lane('lane-old', 'clip-source');
        setLiveLanes([before]);

        expect(
            applyClipAutomationLaneTransition(
                ['clip-source', 'clip-target'],
                [before],
                [lane('lane-new', 'clip-target')]
            )
        ).toBe(true);

        expect(liveLaneIds()).toEqual(['lane-new']);
    });

    it('removes nothing when the replacement lanes cannot be restored (regression: post-write rejection)', () => {
        // `restoreAutomationLanes` drops the WHOLE batch when a snapshot fails
        // the automation store's exactness check, and points out of beat order
        // are one way to fail it. That is the documented post-write failure
        // mode: the transition used to retire `lane-old` first, discover the
        // restore had not taken, and report `false` having already destroyed
        // automation the caller was told was untouched.
        const before = lane('lane-old', 'clip-source');
        const unrestorable = lane('lane-new', 'clip-target', [
            { id: 'p2', beat: 8, value: 0.25, curve: 'linear', tension: 0 },
            { id: 'p1', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
        ]);
        setLiveLanes([before]);

        expect(applyClipAutomationLaneTransition(['clip-source', 'clip-target'], [before], [unrestorable])).toBe(false);

        // The rejection must be atomic: the source lane is still live and the
        // replacement never appeared.
        expect(liveLaneIds()).toEqual(['lane-old']);
        expect(automationStore.value!.lanes[0]).toMatchObject({ clipId: 'clip-source' });
    });

    it('rejects before touching the store when the live lanes disagree with the expected snapshot', () => {
        const before = lane('lane-old', 'clip-source');
        setLiveLanes([before]);

        expect(
            applyClipAutomationLaneTransition(
                ['clip-source', 'clip-target'],
                [lane('lane-absent', 'clip-source')],
                [lane('lane-new', 'clip-target')]
            )
        ).toBe(false);

        expect(liveLaneIds()).toEqual(['lane-old']);
    });
});
