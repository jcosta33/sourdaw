/**
 * Writing the Crumbs attachments a batch reported into the mirror (#4204).
 *
 * The mirror decides whether the carrier law gives a Crumbs strip a native
 * body, so both directions of error are visible at the speakers: a missed mark
 * leaves a sampler the engine is rendering reported as degraded for the rest of
 * the session, and a mark from an outcome that attached nothing builds the next
 * topology naming an instance the engine does not hold, which the mapper
 * refuses whole.
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

    // A `needs-reconcile` batch changed part of the graph and could not say
    // what it left behind, so nothing about it is evidence that the engine took
    // an instance over.
    it('marks nothing for a needs-reconcile outcome', () => {
        markAttachedCrumbsInstances({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'partially applied',
            runtimeRevision: 2,
            reports: [],
        });

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });

    it('marks nothing for a rejected batch', () => {
        markAttachedCrumbsInstances({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'refused',
        });

        expect(crumbsEngineAttachmentStore.value).toEqual(new Set());
    });
});
