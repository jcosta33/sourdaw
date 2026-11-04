import { describe, expect, it, vi } from 'vitest';

import { decodeTempoMapRowPlan, type TempoMapRow, type TempoMapRowPlan } from '#/utils/tempoMapRowPlan';

import { createTempoChange, getTempoAtBeat, secondsBetweenBeats } from '../../../models/TempoMap';
import { applyTempoMapRowPlan } from '../applyTempoMapRowPlan';
import { planTempoMapEdit } from '../planTempoMapEdit';

const row = (id: string, beat = 4, tempo = 120, curve: TempoMapRow['curve'] = 'instant'): TempoMapRow => ({
    id,
    beat,
    tempo,
    curve,
});

function ready(result: ReturnType<typeof planTempoMapEdit>): TempoMapRowPlan {
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') {
        throw new Error('Expected a prepared tempo-map row plan');
    }
    return result.plan;
}

function producer(...ids: string[]) {
    return vi.fn((beat: number, tempo: number, curve: TempoMapRow['curve']) => {
        const id = ids.shift();
        if (!id) {
            throw new Error('Unexpected row allocation');
        }
        return { ...createTempoChange(beat, tempo, curve), id };
    });
}

describe('tempo-map row preparation', () => {
    it('updates the last EPS collision and preserves arrival-before-head ramp semantics', () => {
        const changes = [row('start', 0, 100, 'linear'), row('arrival', 4, 80), row('head', 4, 140), row('end', 8)];
        const createRow = producer();
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'add', beat: 4 + 5e-7, tempo: 200 }, createRow }));
        expect(plan.before).toEqual([changes[2]]);
        expect(plan.collision).toEqual({ beat: 4 + 5e-7, targetId: 'head' });
        const next = applyTempoMapRowPlan({ changes, plan });
        expect(next).toEqual([changes[0], changes[1], row('head', 4, 200), changes[3]]);
        expect(secondsBetweenBeats(next!, 0, 4, 120)).toBe(secondsBetweenBeats(changes, 0, 4, 120));
        expect(getTempoAtBeat(next!, 4, 120)).toBe(200);
        expect(applyTempoMapRowPlan({ changes: next!, plan, direction: 'restore' })).toEqual(changes);
        expect(createRow).not.toHaveBeenCalled();
    });

    it('sorts add-new forward and keeps minted IDs through Undo/Redo with unrelated peers', () => {
        const changes = [row('late', 12), row('early', 0)];
        const createRow = producer('minted');
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'add', beat: 4, tempo: 110 }, createRow }));
        const next = applyTempoMapRowPlan({ changes, plan });
        expect(next?.map((change) => change.id)).toEqual(['early', 'minted', 'late']);
        const peer = row('peer', 20, 90);
        const undone = applyTempoMapRowPlan({ changes: [...next!, peer], plan, direction: 'restore' });
        expect(undone).toEqual([changes[1], changes[0], peer]);
        expect(applyTempoMapRowPlan({ changes: undone!, plan })).toEqual([...next!, peer]);
        expect(createRow).toHaveBeenCalledTimes(1);
        expect(changes.map((change) => change.id)).toEqual(['late', 'early']);
    });

    it('refuses a newly arriving EPS collision even when no exact-beat cohort changed', () => {
        const changes = [row('start', 0)];
        const plan = ready(
            planTempoMapEdit({ changes, edit: { type: 'add', beat: 4, tempo: 110 }, createRow: producer('minted') })
        );
        const peer = row('peer', 4 + 5e-7, 90);
        const current = [...changes, peer];
        expect(applyTempoMapRowPlan({ changes: current, plan })).toBeNull();
        expect(current).toEqual([...changes, peer]);
    });

    it('refuses a late collision that changes the existing add target', () => {
        const changes = [row('old', 4)];
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'add', beat: 4, tempo: 110 } }));
        expect(applyTempoMapRowPlan({ changes: [...changes, row('peer', 4 + 5e-7)], plan })).toBeNull();
    });

    it('retains update clamping and missing-id no-op semantics without normalizing saved rows', () => {
        const changes = [row('target'), row('peer', 12)];
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'update', id: 'target', tempo: 1000 } }));
        expect(plan.after).toEqual([row('target', 4, 999)]);
        expect(applyTempoMapRowPlan({ changes, plan })).toEqual([row('target', 4, 999), changes[1]]);
        expect(planTempoMapEdit({ changes, edit: { type: 'update', id: 'missing', tempo: 90 } })).toEqual({
            status: 'no-op',
        });
        expect(planTempoMapEdit({ changes, edit: { type: 'remove', id: 'missing' } })).toEqual({ status: 'no-op' });
        const forged = { ...plan, after: [row('target', 4, 1000)] };
        expect(decodeTempoMapRowPlan(forged)).not.toBeNull();
        expect(applyTempoMapRowPlan({ changes, plan: forged })).toBeNull();
    });

    it.each(['tempo', 'beat', 'curve'] as const)('refuses peer changes to the captured %s', (field) => {
        const changes = [row('target'), row('other', 12)];
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'update', id: 'target', tempo: 140 } }));
        const changed = { ...changes[0]!, tempo: 90, beat: 5, curve: 'linear' as const };
        const peer = { ...changes[0]!, [field]: changed[field] };
        expect(applyTempoMapRowPlan({ changes: [peer, changes[1]!], plan })).toBeNull();
    });

    it('restores the exact equal-beat order and refuses newly authored same-beat ordering', () => {
        const changes = [row('start', 0, 100, 'linear'), row('arrival', 4, 80), row('head', 4, 140), row('end', 8)];
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'remove', id: 'head' } }));
        const next = applyTempoMapRowPlan({ changes, plan });
        expect(getTempoAtBeat(next!, 4, 120)).toBe(80);
        const restored = applyTempoMapRowPlan({ changes: next!, plan, direction: 'restore' });
        expect(restored?.filter((change) => change.beat === 4).map((change) => change.id)).toEqual(['arrival', 'head']);
        expect(getTempoAtBeat(restored!, 4, 120)).toBe(140);
        expect(secondsBetweenBeats(restored!, 0, 4, 120)).toBe(secondsBetweenBeats(changes, 0, 4, 120));
        expect(applyTempoMapRowPlan({ changes: [...next!, row('peer', 4)], plan, direction: 'restore' })).toBeNull();
        expect(
            applyTempoMapRowPlan({ changes: [changes[0]!, changes[2]!, changes[1]!, changes[3]!], plan })
        ).toBeNull();
    });

    it('keeps replace supplied order and preserves later unrelated peer rows across both legs', () => {
        const changes = [row('old-a', 0), row('old-b', 8, 90)];
        const createRow = producer('new-a', 'new-b');
        const plan = ready(
            planTempoMapEdit({
                changes,
                edit: { type: 'replace', changes: [row('ignored', 8, 72, 'linear'), row('ignored', 0, 90)] },
                createRow,
            })
        );
        const next = applyTempoMapRowPlan({ changes, plan });
        expect(next).toEqual([row('new-a', 8, 72, 'linear'), row('new-b', 0, 90)]);
        const peer = row('peer', 20);
        const undone = applyTempoMapRowPlan({ changes: [...next!, peer], plan, direction: 'restore' });
        expect(undone).toEqual([...changes, peer]);
        expect(applyTempoMapRowPlan({ changes: undone!, plan })).toEqual([...next!, peer]);
        expect(createRow).toHaveBeenCalledTimes(2);
    });

    it('preserves an unrelated peer deletion rather than acquiring snapshot ownership of it', () => {
        const changes = [row('own'), row('peer', 12)];
        const plan = ready(planTempoMapEdit({ changes, edit: { type: 'remove', id: 'own' } }));
        expect(applyTempoMapRowPlan({ changes: [changes[0]!], plan })).toEqual([]);
        expect(applyTempoMapRowPlan({ changes: [], plan, direction: 'restore' })).toEqual([changes[0]]);
    });

    it('refuses reused minted IDs, duplicate raw IDs and missing source rows', () => {
        const changes = [row('own')];
        const plan = ready(
            planTempoMapEdit({ changes, edit: { type: 'add', beat: 8, tempo: 120 }, createRow: producer('minted') })
        );
        expect(applyTempoMapRowPlan({ changes: [...changes, row('minted', 20)], plan })).toBeNull();
        expect(applyTempoMapRowPlan({ changes: [changes[0]!, changes[0]!], plan })).toBeNull();
        expect(planTempoMapEdit({ changes: [changes[0]!, changes[0]!], edit: { type: 'remove', id: 'own' } })).toEqual({
            status: 'rejected',
        });
        const removal = ready(planTempoMapEdit({ changes, edit: { type: 'remove', id: 'own' } }));
        expect(applyTempoMapRowPlan({ changes: [], plan: removal })).toBeNull();
    });

    it('handles absent and empty maps without allocating on no-op or invalid replacement', () => {
        const createRow = producer('new');
        expect(planTempoMapEdit({ changes: null, edit: { type: 'add', beat: 4, tempo: 120 }, createRow })).toEqual({
            status: 'no-op',
        });
        expect(planTempoMapEdit({ changes: [], edit: { type: 'replace', changes: [] }, createRow })).toEqual({
            status: 'no-op',
        });
        expect(
            planTempoMapEdit({ changes: [], edit: { type: 'replace', changes: [row('ignored', 0, 1000)] }, createRow })
        ).toEqual({ status: 'rejected' });
        expect(createRow).not.toHaveBeenCalled();
        const plan = ready(
            planTempoMapEdit({ changes: null, edit: { type: 'replace', changes: [row('ignored', 0)] }, createRow })
        );
        expect(applyTempoMapRowPlan({ changes: [], plan })).toEqual([row('new', 0)]);
    });

    it('leaves the input unchanged when application ID construction fails partway', () => {
        const changes = [row('old')];
        const before = structuredClone(changes);
        const createRow = producer('first');
        expect(() =>
            planTempoMapEdit({
                changes,
                edit: { type: 'replace', changes: [row('ignored', 0), row('ignored', 8)] },
                createRow,
            })
        ).toThrow('Unexpected row allocation');
        expect(changes).toEqual(before);
    });

    it.each([{ beat: 8 }, { tempo: 121 }, { curve: 'linear' as const }])(
        'refuses a producer row that changes the requested row apart from its minted id %j',
        (change) => {
            const createRow = vi.fn(() => ({ ...row('minted'), ...change }));
            expect(
                planTempoMapEdit({ changes: [], edit: { type: 'replace', changes: [row('ignored')] }, createRow })
            ).toEqual({ status: 'rejected' });
        }
    );
});
