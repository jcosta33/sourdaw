import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';

import { projectChangedCrdtSlots } from '../projectChangedCrdtSlots';
import { projectCrdtToStores } from '../projectProjection';
import { projectSlotProjections } from '../projectSlotProjections';

/**
 * The projection registry is the single source for which document slot feeds
 * which store, so these tests drive the real registry and observe dispatch on
 * the real store objects instead of re-listing the stores in mocks (a second
 * hand-maintained list would drift from production the moment a slot moves).
 */

type DispatchRecord = {
    slots: string[];
    restore: () => void;
};

function spyOnProjections(): DispatchRecord {
    const slots: string[] = [];
    const spies: MockInstance[] = [];
    for (const projection of projectSlotProjections) {
        const spy = vi.spyOn(projection, 'hydrate');
        spy.mockImplementation(() => {
            slots.push(projection.slot);
        });
        spies.push(spy);
    }
    return {
        slots,
        restore: () => {
            for (const spy of spies) {
                spy.mockRestore();
            }
        },
    };
}

describe('projectCrdtToStores', () => {
    let dispatched: DispatchRecord | null = null;

    afterEach(() => {
        dispatched?.restore();
        dispatched = null;
    });

    it('runs the projection of every registered root slot exactly once', () => {
        dispatched = spyOnProjections();

        projectCrdtToStores();

        expect(dispatched.slots).toEqual(projectSlotProjections.map((projection) => projection.slot));
    });
});

describe('projectChangedCrdtSlots (audit CC-1)', () => {
    let dispatched: DispatchRecord | null = null;

    afterEach(() => {
        dispatched?.restore();
        dispatched = null;
    });

    it('projects only the changed slot for a document-origin change', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['transport'], origin: 'document' });

        expect(dispatched.slots).toEqual(['transport']);
    });

    it('projects adjustment layers for a document-origin change', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['adjustmentLayers'], origin: 'document' });

        expect(dispatched.slots).toEqual(['adjustmentLayers']);
    });

    it('projects several changed slots in registry order', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['markers', 'tracks'], origin: 'document' });

        expect(dispatched.slots).toEqual(['tracks', 'markers', 'knead']);
    });

    it('skips the writing adapter own slot for a local-store change', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['transport'], origin: 'local-store' });

        expect(dispatched.slots).toEqual([]);
    });

    it('still projects a slot derived from the locally written sibling slot', () => {
        dispatched = spyOnProjections();

        // `knead` is rebuilt from trackStore clip state, so a local `tracks`
        // write must refresh it even though `tracks` itself is skipped.
        projectChangedCrdtSlots({ changedSlots: ['tracks'], origin: 'local-store' });

        expect(dispatched.slots).toEqual(['knead']);
    });

    it('does not drag the Yeast projection into a groove-template change', () => {
        dispatched = spyOnProjections();

        // The yeast projection used to declare `grooveTemplates` as a trigger
        // because it reconciled assignments. That reconciliation moved to the
        // mutation site (review round 1 on PR #793), so the yeast slot now
        // depends on nothing but itself.
        projectChangedCrdtSlots({ changedSlots: ['grooveTemplates'], origin: 'local-store' });

        expect(dispatched.slots).toEqual([]);
    });

    it('projects the groove-template slot itself on a document-origin change', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['grooveTemplates'], origin: 'document' });

        expect(dispatched.slots).toEqual(['grooveTemplates']);
    });

    it('projects nothing when a change reports no slots', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: [], origin: 'document' });

        expect(dispatched.slots).toEqual([]);
    });

    it('ignores slot keys that back no projection', () => {
        dispatched = spyOnProjections();

        projectChangedCrdtSlots({ changedSlots: ['notASlot'], origin: 'document' });

        expect(dispatched.slots).toEqual([]);
    });
});
