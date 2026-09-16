/**
 * Writing the Crumbs attachments an answer reported into the mirror (#4204).
 *
 * The mirror decides whether the carrier law gives a Crumbs strip a native
 * body, so both directions of error are visible at the speakers: a missed mark
 * leaves a sampler the engine is rendering reported as degraded for the rest of
 * the session, and a mark from an answer that attached nothing builds the next
 * topology naming an instance the engine does not hold, which the mapper
 * refuses whole.
 *
 * Which answers count is the whole point of the cases below. The Crumbs attach
 * runs before `apply_graph_commands` maps its batch, so a refusal or a partial
 * application can carry one — and dropping those reports is a missed mark on
 * exactly the outcomes a producer retries after.
 *
 * The store is the real one — the mirror is the subject, not a collaborator.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { crumbsEngineAttachmentStore } from '#/modules/Crumbs/stores';

import { type AudioGraphApplyResult } from '../../../models/AudioGraphBackend';
import { markAttachedCrumbsInstances } from '../markAttachedCrumbsInstances';

type AppliedResult = Extract<AudioGraphApplyResult, { application: 'applied' }>;

function applied(attachedCrumbs?: readonly { instanceId: string }[]): AppliedResult {
    const outcome: AppliedResult = {
        acceptance: 'accepted',
        application: 'applied',
        runtimeRevision: 1,
        reports: [],
        attachedPlugins: [],
    };
    if (attachedCrumbs === undefined) {
        return outcome;
    }
    return { ...outcome, attachedCrumbs };
}

afterEach(() => {
    crumbsEngineAttachmentStore.set(new Set<string>());
});

describe('markAttachedCrumbsInstances', () => {
    it('marks every instance an applied batch reported attached', () => {
        markAttachedCrumbsInstances(applied([{ instanceId: 'd-crumbs' }, { instanceId: 'd-other' }]));

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set(['d-crumbs', 'd-other']));
    });

    it('marks nothing for an applied batch that attached nothing', () => {
        markAttachedCrumbsInstances(applied([]));

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });

    it('marks nothing for an applied batch carrying no report at all', () => {
        markAttachedCrumbsInstances(applied());

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });

    // The refusal case is the one that pays for itself. The attach ran before
    // the batch was mapped, so the instance is audible now; the producer will
    // resend the topology, and this mark is what lets that resend claim the
    // native body rather than falling back to Web Audio again.
    it('marks the instances a rejected answer reports, because the attach already ran', () => {
        markAttachedCrumbsInstances({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'refused',
            attachedCrumbs: [{ instanceId: 'd-crumbs' }],
        });

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set(['d-crumbs']));
    });

    it('marks the instances a needs-reconcile answer reports', () => {
        markAttachedCrumbsInstances({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'partially applied',
            runtimeRevision: 2,
            reports: [],
            attachedCrumbs: [{ instanceId: 'd-crumbs' }],
        });

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set(['d-crumbs']));
    });

    // Absent and empty mean the same thing on every outcome — the call took
    // none — so neither may invent a mark.
    it('marks nothing for a rejected answer carrying no report', () => {
        markAttachedCrumbsInstances({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'refused',
        });

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });
});
