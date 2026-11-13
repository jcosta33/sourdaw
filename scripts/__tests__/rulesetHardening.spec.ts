import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    GATE_CONTEXT,
    GITHUB_ACTIONS_INTEGRATION_ID,
    HARDENING_TARGETS,
    RULESET_HARDENING_USAGE,
    assertNoRequiredContextAdded,
    assertOnlyApprovedFieldsChanged,
    assertTargetsSatisfied,
    buildHardenedRuleset,
    captureRollback,
    coordinateRulesetHardening,
    hardenRuleset,
    parseRulesetHardeningArgs,
    planHardening,
    readMainRulesetId,
    readRulesetById,
    renderHardeningReceipt,
    requiredStatusContexts,
    rulesetDifferences,
    runRulesetHardeningCli,
    writableRuleset,
    writeRulesetById,
    type RulesetDocument,
    type RulesetHardeningCoordinatorDependencies,
    type RulesetHardeningPort,
} from '../rulesetHardening.ts';

import type { JsonValue } from '../canonicalRecord.ts';

const RULESET_ID = 20_938_734;
const REPOSITORY = 'jcosta33/sourdaw';
const PULL_REQUEST_INDEX = 2;
const SHADOW_CONTEXT = 'sourdaw/reviewer-shadow';

type FixtureOptions = {
    dismissStaleReviews?: boolean;
    requireLastPushApproval?: boolean;
    reviewCount?: number;
    requireCodeOwnerReview?: boolean;
    requiredReviewers?: JsonValue[];
    mergeMethods?: string[];
    conditions?: RulesetDocument;
    bypassActors?: JsonValue[];
    contexts?: string[];
    checks?: JsonValue[];
    gateIntegrationId?: number;
    strictPolicy?: boolean;
    doNotEnforceOnCreate?: boolean;
    swappedLifecycleRules?: boolean;
};

/** The `contexts` option as check entries, with `gateIntegrationId` pinned on every `Gate` entry. */
function statusChecks(overrides: FixtureOptions): JsonValue[] {
    if (overrides.checks !== undefined) {
        return overrides.checks;
    }
    const pin = overrides.gateIntegrationId;
    return (overrides.contexts ?? ['Gate']).map((context) =>
        context === 'Gate' && pin !== undefined ? { context, integration_id: pin } : { context }
    );
}

/**
 * The live `main` ruleset's shape. Every hardening test starts from the same fixture and changes one
 * option, so a refused difference is provably the only difference.
 */
function fixture(overrides: FixtureOptions = {}): RulesetDocument {
    const lifecycle: JsonValue[] = [];
    if (overrides.swappedLifecycleRules === true) {
        lifecycle.push({ type: 'non_fast_forward' }, { type: 'deletion' });
    } else {
        lifecycle.push({ type: 'deletion' }, { type: 'non_fast_forward' });
    }
    const pullRequest: JsonValue = {
        type: 'pull_request',
        parameters: {
            required_approving_review_count: overrides.reviewCount ?? 2,
            dismiss_stale_reviews_on_push: overrides.dismissStaleReviews ?? false,
            required_reviewers: overrides.requiredReviewers ?? [],
            require_code_owner_review: overrides.requireCodeOwnerReview ?? false,
            require_last_push_approval: overrides.requireLastPushApproval ?? false,
            required_review_thread_resolution: true,
            require_extra_approval_for_unattributed_changes: true,
            allowed_merge_methods: overrides.mergeMethods ?? ['squash'],
        },
    };
    const requiredStatusChecks: JsonValue = {
        type: 'required_status_checks',
        parameters: {
            strict_required_status_checks_policy: overrides.strictPolicy ?? false,
            do_not_enforce_on_create: overrides.doNotEnforceOnCreate ?? false,
            required_status_checks: statusChecks(overrides),
        },
    };
    return {
        id: RULESET_ID,
        name: 'main',
        target: 'branch',
        source_type: 'Repository',
        source: REPOSITORY,
        enforcement: 'active',
        conditions: overrides.conditions ?? { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
        rules: [...lifecycle, pullRequest, requiredStatusChecks],
        node_id: 'RRS_lACqUmVwb3NpdG9yec5GhtqlzgE_f-4',
        created_at: '2026-08-17T12:36:15.920+02:00',
        updated_at: '2026-09-09T12:14:38.488+02:00',
        bypass_actors: overrides.bypassActors ?? [],
        current_user_can_bypass: 'never',
        _links: { self: { href: `https://api.github.com/repos/${REPOSITORY}/rulesets/${String(RULESET_ID)}` } },
    };
}

/** The three pull_request controls at their targets. */
const HELD: FixtureOptions = { dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 };

/**
 * The live `main` shape this command is meant to find: the pull_request controls already hold and
 * the required `Gate` check carries no `integration_id`, awaiting the GitHub Actions pin.
 */
function liveShape(): RulesetDocument {
    return fixture(HELD);
}

/** Every approved change at its target. */
function hardenedShape(): RulesetDocument {
    return fixture({ ...HELD, gateIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID });
}

/** A ruleset whose approving-review count is still 2 while the Gate pin already holds. */
function countUnsatisfiedShape(): RulesetDocument {
    return fixture({
        dismissStaleReviews: true,
        requireLastPushApproval: true,
        gateIntegrationId: GITHUB_ACTIONS_INTEGRATION_ID,
    });
}

const GATE_PIN_PATH = 'rules[3].parameters.required_status_checks[0].integration_id';

function rulesetWithoutApprovedFields(): RulesetDocument {
    return {
        name: 'main',
        rules: [
            { type: 'pull_request', parameters: {} },
            { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Gate' }] } },
        ],
    };
}

type FakePort = {
    port: RulesetHardeningPort;
    writes: { rulesetId: number; ruleset: RulesetDocument }[];
    reads: number[];
    logs: string[];
    /** Every log line and every write (as `write:<id>`) in the order the port saw them. */
    trail: string[];
};

/**
 * A port double that answers the first read with `live`, the second (the pre-write re-read) with
 * `beforeWrite`, and every later read with `readback`.
 */
function fakePort(
    live: RulesetDocument,
    readback: RulesetDocument = live,
    beforeWrite: RulesetDocument = live
): FakePort {
    const writes: { rulesetId: number; ruleset: RulesetDocument }[] = [];
    const reads: number[] = [];
    const logs: string[] = [];
    const trail: string[] = [];
    const answers = [live, beforeWrite];
    return {
        port: {
            resolveRulesetId: () => RULESET_ID,
            readRuleset: (rulesetId) => {
                reads.push(rulesetId);
                return answers[reads.length - 1] ?? readback;
            },
            writeRuleset: (rulesetId, ruleset) => {
                writes.push({ rulesetId, ruleset });
                trail.push(`write:${String(rulesetId)}`);
            },
            log: (message) => {
                logs.push(message);
                trail.push(message);
            },
        },
        writes,
        reads,
        logs,
        trail,
    };
}

const APPROVED_SET =
    'refusing ruleset change outside the approved set dismiss_stale_reviews_on_push, require_last_push_approval, required_approving_review_count, gate_integration_id';

describe('HARDENING_TARGETS', () => {
    it('should name exactly the approved fields and their targets', () => {
        expect(HARDENING_TARGETS).toEqual([
            { field: 'dismiss_stale_reviews_on_push', to: true },
            { field: 'require_last_push_approval', to: true },
            { field: 'required_approving_review_count', to: 1 },
            { field: 'gate_integration_id', to: 15368 },
        ]);
        expect(HARDENING_TARGETS).toHaveLength(4);
        expect(GATE_CONTEXT).toBe('Gate');
        expect(GITHUB_ACTIONS_INTEGRATION_ID).toBe(15368);
    });
});

describe('planHardening', () => {
    it('should report exactly the Gate pin unsatisfied on the live shape', () => {
        const plan = planHardening(liveShape());
        expect(plan.ruleIndex).toBe(PULL_REQUEST_INDEX);
        expect(plan.satisfied).toBe(false);
        expect(plan.changes.filter((change) => !change.satisfied)).toEqual([
            {
                field: 'gate_integration_id',
                path: GATE_PIN_PATH,
                satisfied: false,
                from: undefined,
                to: 15368,
            },
        ]);
        expect(plan.changes.map((change) => change.path)).toEqual([
            'rules[2].parameters.dismiss_stale_reviews_on_push',
            'rules[2].parameters.require_last_push_approval',
            'rules[2].parameters.required_approving_review_count',
            GATE_PIN_PATH,
        ]);
    });

    it('should report exactly the review count unsatisfied when the Gate pin already holds', () => {
        const plan = planHardening(countUnsatisfiedShape());
        expect(plan.satisfied).toBe(false);
        expect(plan.changes.filter((change) => !change.satisfied)).toEqual([
            {
                field: 'required_approving_review_count',
                path: 'rules[2].parameters.required_approving_review_count',
                satisfied: false,
                from: 2,
                to: 1,
            },
        ]);
    });

    it('should report already satisfied when every field holds its target', () => {
        const plan = planHardening(hardenedShape());
        expect(plan.satisfied).toBe(true);
        expect(plan.changes.every((change) => change.satisfied)).toBe(true);
    });

    it('should read a Gate pinned to another integration as unsatisfied', () => {
        const plan = planHardening(fixture({ ...HELD, gateIntegrationId: 99 }));
        expect(plan.changes.filter((change) => !change.satisfied)).toEqual([
            { field: 'gate_integration_id', path: GATE_PIN_PATH, satisfied: false, from: 99, to: 15368 },
        ]);
    });

    it('should read an absent approved field as unsatisfied with no from value', () => {
        const plan = planHardening(rulesetWithoutApprovedFields());
        expect(plan.changes).toEqual([
            {
                field: 'dismiss_stale_reviews_on_push',
                path: 'rules[0].parameters.dismiss_stale_reviews_on_push',
                satisfied: false,
                from: undefined,
                to: true,
            },
            {
                field: 'require_last_push_approval',
                path: 'rules[0].parameters.require_last_push_approval',
                satisfied: false,
                from: undefined,
                to: true,
            },
            {
                field: 'required_approving_review_count',
                path: 'rules[0].parameters.required_approving_review_count',
                satisfied: false,
                from: undefined,
                to: 1,
            },
            {
                field: 'gate_integration_id',
                path: 'rules[1].parameters.required_status_checks[0].integration_id',
                satisfied: false,
                from: undefined,
                to: 15368,
            },
        ]);
    });

    it('should locate Gate among other contexts by its own index', () => {
        const plan = planHardening(fixture({ ...HELD, contexts: ['CI', 'Gate'] }));
        expect(plan.changes.at(-1)?.path).toBe('rules[3].parameters.required_status_checks[1].integration_id');
    });

    it('should refuse a ruleset with no pull_request rule or more than one', () => {
        expect(() => planHardening({ name: 'main', rules: [{ type: 'deletion' }] })).toThrow(
            'ruleset has no pull_request rule to harden'
        );
        expect(() =>
            planHardening({
                name: 'main',
                rules: [
                    { type: 'pull_request', parameters: {} },
                    { type: 'pull_request', parameters: {} },
                ],
            })
        ).toThrow('ruleset has 2 pull_request rules; hardening needs exactly one');
        expect(() => planHardening({ name: 'main' })).toThrow('ruleset has no readable rules array');
    });

    it('should refuse a ruleset with no Gate check, since adding one is not an approved change', () => {
        expect(() => planHardening(fixture({ ...HELD, contexts: [] }))).toThrow(
            'ruleset requires no Gate status check to pin'
        );
        expect(() => planHardening(fixture({ ...HELD, contexts: ['CI'] }))).toThrow(
            'ruleset requires no Gate status check to pin'
        );
        expect(() => planHardening({ name: 'main', rules: [{ type: 'pull_request', parameters: {} }] })).toThrow(
            'ruleset requires no Gate status check to pin'
        );
    });

    it('should refuse a ruleset with two Gate checks rather than guess which to pin', () => {
        expect(() => planHardening(fixture({ ...HELD, contexts: ['Gate', 'Gate'] }))).toThrow(
            'ruleset requires 2 Gate status checks; pinning needs exactly one'
        );
    });
});

describe('buildHardenedRuleset', () => {
    it('should set every approved field to its target and alter nothing else', () => {
        const live = liveShape();
        const hardened = buildHardenedRuleset(live);
        expect(hardened).toEqual(hardenedShape());
        expect(hardened).not.toBe(live);
        expect(hardened.rules).not.toBe(live.rules);
    });

    it('should leave its input unmutated', () => {
        const live = liveShape();
        buildHardenedRuleset(live);
        expect(live).toEqual(liveShape());
        expect(live).not.toEqual(hardenedShape());
    });

    it('should pin only the Gate entry among several contexts', () => {
        const live = fixture({ ...HELD, contexts: ['CI', 'Gate', 'Lint'] });
        expect(buildHardenedRuleset(live)).toEqual(
            fixture({
                ...HELD,
                checks: [{ context: 'CI' }, { context: 'Gate', integration_id: 15368 }, { context: 'Lint' }],
            })
        );
    });

    it('should add an absent approved field at its target', () => {
        expect(buildHardenedRuleset(rulesetWithoutApprovedFields())).toEqual({
            name: 'main',
            rules: [
                {
                    type: 'pull_request',
                    parameters: {
                        dismiss_stale_reviews_on_push: true,
                        require_last_push_approval: true,
                        required_approving_review_count: 1,
                    },
                },
                {
                    type: 'required_status_checks',
                    parameters: { required_status_checks: [{ context: 'Gate', integration_id: 15368 }] },
                },
            ],
        });
    });

    it('should pass its own approved-set guard and differ only at the approved paths', () => {
        const live = liveShape();
        expect(() => assertOnlyApprovedFieldsChanged(live, buildHardenedRuleset(live))).not.toThrow();
        expect(() => assertTargetsSatisfied(buildHardenedRuleset(live))).not.toThrow();
        expect(rulesetDifferences(live, buildHardenedRuleset(live))).toEqual([GATE_PIN_PATH]);
        expect(rulesetDifferences(countUnsatisfiedShape(), buildHardenedRuleset(countUnsatisfiedShape()))).toEqual([
            'rules[2].parameters.required_approving_review_count',
        ]);
    });
});

describe('assertOnlyApprovedFieldsChanged', () => {
    const before = liveShape();

    const REFUSED: { label: string; after: RulesetDocument; path: string }[] = [
        {
            label: 'require_code_owner_review',
            after: fixture({ ...HELD, requireCodeOwnerReview: true }),
            path: 'rules[2].parameters.require_code_owner_review',
        },
        {
            label: 'allowed_merge_methods',
            after: fixture({ ...HELD, mergeMethods: ['squash', 'merge'] }),
            path: 'rules[2].parameters.allowed_merge_methods[1]',
        },
        {
            label: 'required_reviewers',
            after: fixture({ ...HELD, requiredReviewers: [{ id: 1, name: 'reviewer' }] }),
            path: 'rules[2].parameters.required_reviewers[0]',
        },
        {
            label: 'conditions',
            after: fixture({ ...HELD, conditions: { ref_name: { exclude: [], include: ['main'] } } }),
            path: 'conditions.ref_name.include[0]',
        },
        {
            label: 'bypass actors',
            after: fixture({ ...HELD, bypassActors: [{ actor_id: 1, actor_type: 'Team', bypass_mode: 'always' }] }),
            path: 'bypass_actors[0]',
        },
        {
            label: 'rule order',
            after: fixture({ ...HELD, swappedLifecycleRules: true }),
            path: 'rules[0].type',
        },
        {
            label: 'enforcement',
            after: { ...liveShape(), enforcement: 'disabled' },
            path: 'enforcement',
        },
        {
            label: 'Gate removal',
            after: fixture({ ...HELD, contexts: [] }),
            path: 'rules[3].parameters.required_status_checks[0]',
        },
        {
            label: 'Gate renamed to gate beside the pin',
            after: fixture({ ...HELD, checks: [{ context: 'gate', integration_id: 15368 }] }),
            path: 'rules[3].parameters.required_status_checks[0].context',
        },
        {
            label: 'Gate renamed to Gate2',
            after: fixture({ ...HELD, contexts: ['Gate2'] }),
            path: 'rules[3].parameters.required_status_checks[0].context',
        },
        {
            label: 'strict_required_status_checks_policy',
            after: fixture({ ...HELD, gateIntegrationId: 15368, strictPolicy: true }),
            path: 'rules[3].parameters.strict_required_status_checks_policy',
        },
        {
            label: 'do_not_enforce_on_create',
            after: fixture({ ...HELD, gateIntegrationId: 15368, doNotEnforceOnCreate: true }),
            path: 'rules[3].parameters.do_not_enforce_on_create',
        },
        {
            label: 'Gate gaining another key beside the pin',
            after: fixture({ ...HELD, checks: [{ context: 'Gate', integration_id: 15368, app_id: 15368 }] }),
            path: 'rules[3].parameters.required_status_checks[0].app_id',
        },
    ];

    it.each(REFUSED)('should refuse a $label change naming $path', ({ after, path }) => {
        expect(() => assertOnlyApprovedFieldsChanged(before, after)).toThrow(`first at ${path}`);
    });

    it('should refuse an integration_id pinned on a context other than Gate', () => {
        const live = fixture({ ...HELD, contexts: ['Gate', 'CI'] });
        const after = fixture({ ...HELD, checks: [{ context: 'Gate' }, { context: 'CI', integration_id: 15368 }] });
        expect(() => assertOnlyApprovedFieldsChanged(live, after)).toThrow(
            'first at rules[3].parameters.required_status_checks[1].integration_id'
        );
    });

    it('should allow a pair that differs only in the approved fields', () => {
        expect(() => assertOnlyApprovedFieldsChanged(before, buildHardenedRuleset(before))).not.toThrow();
        expect(() => assertOnlyApprovedFieldsChanged(before, before)).not.toThrow();
    });

    it('should name the approved set in the refusal', () => {
        const after = fixture({ ...HELD, requireCodeOwnerReview: true });
        expect(() => assertOnlyApprovedFieldsChanged(before, after)).toThrow(APPROVED_SET);
    });

    /**
     * An approved field changing must not hide an illegal change later in the walk: the Gate pin
     * (approved) alongside an illegal `require_code_owner_review` change must still refuse the
     * illegal path, and likewise the review count.
     */
    it('should refuse an approved change that also carries an illegal change', () => {
        const pinned = fixture({ ...HELD, gateIntegrationId: 15368, requireCodeOwnerReview: true });
        const pinDifferences = rulesetDifferences(before, pinned);
        expect(pinDifferences).toContain(GATE_PIN_PATH);
        expect(pinDifferences).toContain('rules[2].parameters.require_code_owner_review');
        expect(() => assertOnlyApprovedFieldsChanged(before, pinned)).toThrow(
            'rules[2].parameters.require_code_owner_review'
        );

        const countBefore = countUnsatisfiedShape();
        const counted = fixture({ ...HELD, gateIntegrationId: 15368, requireCodeOwnerReview: true });
        expect(rulesetDifferences(countBefore, counted)).toContain(
            'rules[2].parameters.required_approving_review_count'
        );
        expect(() => assertOnlyApprovedFieldsChanged(countBefore, counted)).toThrow(
            'rules[2].parameters.require_code_owner_review'
        );
    });
});

describe('assertTargetsSatisfied', () => {
    it('should refuse a ruleset that leaves an approved field short of its target, naming the path', () => {
        expect(() => assertTargetsSatisfied(fixture({ ...HELD, gateIntegrationId: 15368, reviewCount: 5 }))).toThrow(
            'rules[2].parameters.required_approving_review_count'
        );
        expect(() =>
            assertTargetsSatisfied(fixture({ ...HELD, gateIntegrationId: 15368, dismissStaleReviews: false }))
        ).toThrow('rules[2].parameters.dismiss_stale_reviews_on_push');
    });

    it.each([1, 99, 99_999])('should refuse a Gate pinned to integration %d, naming the pin', (integrationId) => {
        expect(() => assertTargetsSatisfied(fixture({ ...HELD, gateIntegrationId: integrationId }))).toThrow(
            `refusing ruleset change that leaves gate_integration_id at ${String(integrationId)} instead of 15368 (${GATE_PIN_PATH})`
        );
    });

    it('should refuse a Gate with no pin, naming the pin', () => {
        expect(() => assertTargetsSatisfied(liveShape())).toThrow(
            `refusing ruleset change that leaves gate_integration_id at undefined instead of 15368 (${GATE_PIN_PATH})`
        );
    });

    it('should accept a ruleset where every field holds its target', () => {
        expect(() => assertTargetsSatisfied(hardenedShape())).not.toThrow();
    });
});

describe('assertNoRequiredContextAdded', () => {
    it('should refuse the shadow context by name', () => {
        const before = fixture({ contexts: ['Gate'] });
        const after = fixture({ contexts: ['Gate', SHADOW_CONTEXT] });
        expect(requiredStatusContexts(after)).toEqual(['Gate', SHADOW_CONTEXT]);
        expect(() => assertNoRequiredContextAdded(before, after)).toThrow(
            `refusing ruleset change that requires status context(s): ${SHADOW_CONTEXT}`
        );
    });

    it('should refuse a CI context by name', () => {
        const before = fixture({ contexts: ['Gate'] });
        const after = fixture({ contexts: ['Gate', 'CI'] });
        expect(() => assertNoRequiredContextAdded(before, after)).toThrow(
            'refusing ruleset change that requires status context(s): CI'
        );
    });

    it('should name every added context', () => {
        const before = fixture({ contexts: ['Gate'] });
        const after = fixture({ contexts: ['Gate', SHADOW_CONTEXT, 'CI'] });
        expect(() => assertNoRequiredContextAdded(before, after)).toThrow(
            `refusing ruleset change that requires status context(s): ${SHADOW_CONTEXT}, CI`
        );
    });

    it('should allow an unchanged or reduced context set', () => {
        expect(() => assertNoRequiredContextAdded(fixture(), buildHardenedRuleset(fixture()))).not.toThrow();
        expect(() =>
            assertNoRequiredContextAdded(fixture({ contexts: ['Gate', 'CI'] }), fixture({ contexts: ['Gate'] }))
        ).not.toThrow();
    });

    it('should refuse an unreadable context list rather than read it as empty', () => {
        expect(() => requiredStatusContexts({ rules: [{ type: 'required_status_checks', parameters: {} }] })).toThrow(
            'rules[0] required_status_checks rule carries no readable check list'
        );
        expect(() =>
            requiredStatusContexts({
                rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{}] } }],
            })
        ).toThrow('rules[0].parameters.required_status_checks[0] has no readable context');
    });
});

describe('captureRollback', () => {
    const ROLLBACK_FIXTURE: RulesetDocument = {
        name: 'main',
        rules: [
            {
                type: 'pull_request',
                parameters: { require_last_push_approval: false, dismiss_stale_reviews_on_push: false },
            },
        ],
        bypass_actors: [],
    };

    const ROLLBACK_BYTES =
        '{"bypass_actors":[],"name":"main","rules":[{"parameters":{"dismiss_stale_reviews_on_push":false,"require_last_push_approval":false},"type":"pull_request"}]}';

    it('should pin the canonical bytes of a fixed fixture', () => {
        expect(captureRollback(ROLLBACK_FIXTURE)).toBe(ROLLBACK_BYTES);
    });

    it('should capture the pre-mutation bytes, never the hardened plan', () => {
        const live = liveShape();
        const rollback = captureRollback(live);
        buildHardenedRuleset(live);
        expect(captureRollback(live)).toBe(rollback);
        expect(rollback).toContain('{"context":"Gate"}');
        expect(rollback).not.toContain('integration_id');
    });
});

describe('writableRuleset', () => {
    it('should keep only the keys the update endpoint accepts', () => {
        const projection = writableRuleset(fixture());
        expect(Object.keys(projection).sort()).toEqual([
            'bypass_actors',
            'conditions',
            'enforcement',
            'name',
            'rules',
            'target',
        ]);
        expect(projection).not.toHaveProperty('updated_at');
        expect(projection).not.toHaveProperty('node_id');
        expect(projection).not.toHaveProperty('_links');
    });

    it('should refuse a ruleset with no name', () => {
        expect(() => writableRuleset({ rules: [] })).toThrow('refusing to write a ruleset with no name');
    });
});

describe('hardenRuleset', () => {
    it('should write once with only the Gate pin changed, then read back', () => {
        const live = liveShape();
        const { port, writes, reads, trail } = fakePort(live, hardenedShape());
        const receipt = hardenRuleset(true, port);
        expect(receipt).toEqual({
            rulesetId: RULESET_ID,
            outcome: 'applied',
            changed: ['gate_integration_id'],
            rollback: captureRollback(live),
        });
        expect(writes).toHaveLength(1);
        expect(writes[0]).toEqual({ rulesetId: RULESET_ID, ruleset: hardenedShape() });
        expect(rulesetDifferences(live, writes[0]?.ruleset ?? {})).toEqual([GATE_PIN_PATH]);
        expect(reads).toEqual([RULESET_ID, RULESET_ID, RULESET_ID]);
        expect(trail).toEqual([
            `ruleset-rollback:${String(RULESET_ID)}:${captureRollback(live)}`,
            `write:${String(RULESET_ID)}`,
            `ruleset-hardening:${String(RULESET_ID)}:applied:gate_integration_id`,
        ]);
    });

    it('should write once with the review count at 1 when only the count is short', () => {
        const live = countUnsatisfiedShape();
        const { port, writes, trail } = fakePort(live, hardenedShape());
        expect(hardenRuleset(true, port).changed).toEqual(['required_approving_review_count']);
        expect(writes[0]?.ruleset).toEqual(hardenedShape());
        expect(trail).toEqual([
            `ruleset-rollback:${String(RULESET_ID)}:${captureRollback(live)}`,
            `write:${String(RULESET_ID)}`,
            `ruleset-hardening:${String(RULESET_ID)}:applied:required_approving_review_count`,
        ]);
    });

    it('should perform no write in a dry run and print the plan', () => {
        const live = liveShape();
        const { port, writes, reads, logs } = fakePort(live);
        const receipt = hardenRuleset(false, port);
        expect(receipt).toEqual({
            rulesetId: RULESET_ID,
            outcome: 'dry-run',
            changed: ['gate_integration_id'],
            rollback: captureRollback(live),
        });
        expect(writes).toEqual([]);
        expect(reads).toEqual([RULESET_ID]);
        expect(logs).toEqual([
            'ruleset-hardening-plan:rules[2].parameters.dismiss_stale_reviews_on_push:true->true',
            'ruleset-hardening-plan:rules[2].parameters.require_last_push_approval:true->true',
            'ruleset-hardening-plan:rules[2].parameters.required_approving_review_count:1->1',
            'ruleset-hardening-plan:rules[3].parameters.required_status_checks[0].integration_id:undefined->15368',
            `ruleset-hardening:${String(RULESET_ID)}:dry-run:gate_integration_id`,
        ]);
    });

    it('should write nothing and say so when every field already holds', () => {
        const live = hardenedShape();
        const { port, writes, reads, logs } = fakePort(live);
        const receipt = hardenRuleset(true, port);
        expect(receipt).toEqual({
            rulesetId: RULESET_ID,
            outcome: 'already-satisfied',
            changed: [],
            rollback: captureRollback(live),
        });
        expect(writes).toEqual([]);
        expect(reads).toEqual([RULESET_ID]);
        expect(logs).toEqual([`ruleset-hardening:${String(RULESET_ID)}:already-satisfied:none`]);
        expect(renderHardeningReceipt(receipt)).toBe(`ruleset-hardening:${String(RULESET_ID)}:already-satisfied:none`);
    });

    const REFUSED_CANDIDATES: { label: string; candidate: () => RulesetDocument; refusal: string }[] = [
        {
            label: 'the shadow context beside the pin',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 15368, contexts: ['Gate', SHADOW_CONTEXT] }),
            refusal: `refusing ruleset change that requires status context(s): ${SHADOW_CONTEXT}`,
        },
        {
            label: 'a CI context beside the pin',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 15368, contexts: ['Gate', 'CI'] }),
            refusal: 'refusing ruleset change that requires status context(s): CI',
        },
        {
            label: 'no Gate check',
            candidate: () => fixture({ ...HELD, contexts: [] }),
            refusal: `${APPROVED_SET}: 1 disallowed difference(s), first at rules[3].parameters.required_status_checks[0]`,
        },
        {
            label: 'Gate renamed to gate',
            candidate: () => fixture({ ...HELD, checks: [{ context: 'gate', integration_id: 15368 }] }),
            refusal: 'refusing ruleset change that requires status context(s): gate',
        },
        {
            label: 'Gate renamed to Gate2',
            candidate: () => fixture({ ...HELD, checks: [{ context: 'Gate2', integration_id: 15368 }] }),
            refusal: 'refusing ruleset change that requires status context(s): Gate2',
        },
        {
            label: 'a strict status-check policy',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 15368, strictPolicy: true }),
            refusal: 'first at rules[3].parameters.strict_required_status_checks_policy',
        },
        {
            label: 'do_not_enforce_on_create',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 15368, doNotEnforceOnCreate: true }),
            refusal: 'first at rules[3].parameters.do_not_enforce_on_create',
        },
        {
            label: 'Gate pinned to integration 1',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 1 }),
            refusal: `leaves gate_integration_id at 1 instead of 15368 (${GATE_PIN_PATH})`,
        },
        {
            label: 'Gate pinned to integration 99999',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 99_999 }),
            refusal: `leaves gate_integration_id at 99999 instead of 15368 (${GATE_PIN_PATH})`,
        },
        {
            label: 'an app_id beside the pin',
            candidate: () => fixture({ ...HELD, checks: [{ context: 'Gate', integration_id: 15368, app_id: 1 }] }),
            refusal: 'first at rules[3].parameters.required_status_checks[0].app_id',
        },
        {
            label: 'the review count at 5',
            candidate: () => fixture({ ...HELD, gateIntegrationId: 15368, reviewCount: 5 }),
            refusal: 'rules[2].parameters.required_approving_review_count',
        },
    ];

    it.each(REFUSED_CANDIDATES)('should refuse a candidate with $label before any write', ({ candidate, refusal }) => {
        const live = liveShape();
        const { port, writes } = fakePort(live, hardenedShape());
        expect(() => hardenRuleset(true, port, candidate)).toThrow(refusal);
        expect(writes).toEqual([]);
    });

    it('should refuse a candidate pinning a context other than Gate before any write', () => {
        const live = fixture({ ...HELD, contexts: ['Gate', 'CI'] });
        const { port, writes } = fakePort(live, live);
        const candidate = () =>
            fixture({ ...HELD, checks: [{ context: 'Gate' }, { context: 'CI', integration_id: 15368 }] });
        expect(() => hardenRuleset(true, port, candidate)).toThrow(
            'first at rules[3].parameters.required_status_checks[1].integration_id'
        );
        expect(writes).toEqual([]);
    });

    it.each([
        ['no Gate check', fixture({ ...HELD, contexts: [] }), 'ruleset requires no Gate status check to pin'],
        [
            'two Gate checks',
            fixture({ ...HELD, contexts: ['Gate', 'Gate'] }),
            'ruleset requires 2 Gate status checks; pinning needs exactly one',
        ],
    ])('should refuse a live ruleset with %s before any write', (_label, live, refusal) => {
        const { port, writes } = fakePort(live);
        expect(() => hardenRuleset(true, port)).toThrow(refusal);
        expect(writes).toEqual([]);
    });

    it('should refuse a readback that added a required context', () => {
        const live = liveShape();
        const readback = fixture({ ...HELD, gateIntegrationId: 15368, contexts: ['Gate', 'CI'] });
        const { port, writes } = fakePort(live, readback);
        expect(() => hardenRuleset(true, port)).toThrow('refusing ruleset change that requires status context(s): CI');
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that dropped the Gate pin', () => {
        const live = liveShape();
        const { port, writes } = fakePort(live, live);
        expect(() => hardenRuleset(true, port)).toThrow(
            `refusing ruleset change that leaves gate_integration_id at undefined instead of 15368 (${GATE_PIN_PATH})`
        );
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that stored the Gate pin as another integration', () => {
        const live = liveShape();
        const { port, writes } = fakePort(live, fixture({ ...HELD, gateIntegrationId: 99 }));
        expect(() => hardenRuleset(true, port)).toThrow(
            `refusing ruleset change that leaves gate_integration_id at 99 instead of 15368 (${GATE_PIN_PATH})`
        );
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that stored the review count at a value other than 1', () => {
        const live = liveShape();
        const readback = fixture({ ...HELD, gateIntegrationId: 15368, reviewCount: 3 });
        const { port, writes } = fakePort(live, readback);
        expect(() => hardenRuleset(true, port)).toThrow('rules[2].parameters.required_approving_review_count');
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that changed a non-approved writable field while meeting every target', () => {
        const live = liveShape();
        const readback = { ...hardenedShape(), enforcement: 'disabled' };
        const { port, writes } = fakePort(live, readback);
        expect(() => hardenRuleset(true, port)).toThrow(
            `${APPROVED_SET}: 1 disallowed difference(s), first at enforcement`
        );
        expect(writes).toHaveLength(1);
    });

    it('should refuse before writing when the ruleset changed between the plan read and the write', () => {
        const live = liveShape();
        const concurrent = fixture({
            ...HELD,
            bypassActors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        });
        const { port, writes, reads } = fakePort(live, hardenedShape(), concurrent);
        expect(() => hardenRuleset(true, port)).toThrow(
            'ruleset changed since it was planned; refusing to overwrite a concurrent edit'
        );
        expect(writes).toEqual([]);
        expect(reads).toEqual([RULESET_ID, RULESET_ID]);
    });

    it('should write once when the pre-write re-read matches the plan read in a server-only field alone', () => {
        const live = liveShape();
        const reread = { ...liveShape(), updated_at: '2026-11-12T09:00:00.000+02:00' };
        const { port, writes } = fakePort(live, hardenedShape(), reread);
        expect(hardenRuleset(true, port).outcome).toBe('applied');
        expect(writes).toHaveLength(1);
    });
});

describe('coordinateRulesetHardening', () => {
    function coordinator(actorNodeId: string, repositoryName = 'jcosta33/sourdaw') {
        const state = { disposed: false, portCalls: 0, hardenCalls: [] as boolean[] };
        const session: GhSession = {
            configDir: '/tmp/sourdaw-ruleset',
            env: {},
            dispose: () => {
                state.disposed = true;
            },
        };
        const dependencies: RulesetHardeningCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateOrchestrator: () => ({ minted: { actorNodeId }, session }),
            repositoryName: () => repositoryName,
            port: () => {
                state.portCalls += 1;
                return fakePort(liveShape(), buildHardenedRuleset(liveShape())).port;
            },
            harden: (apply, port) => {
                state.hardenCalls.push(apply);
                return hardenRuleset(apply, port);
            },
        };
        return { dependencies, state };
    }

    it('should harden as the verified orchestrator User and dispose the session', () => {
        const { dependencies, state } = coordinator(ORCHESTRATOR_USER_NODE_ID);
        const receipt = coordinateRulesetHardening(false, dependencies);
        expect(receipt.outcome).toBe('dry-run');
        expect(state.hardenCalls).toEqual([false]);
        expect(state.disposed).toBe(true);
    });

    it('should refuse a non-orchestrator identity before creating the port or writing', () => {
        const { dependencies, state } = coordinator(AUTHOR_BOT_NODE_ID);
        expect(() => coordinateRulesetHardening(true, dependencies)).toThrow(
            `minted actor ${AUTHOR_BOT_NODE_ID} is not ${ORCHESTRATOR_USER_NODE_ID}`
        );
        expect(state.portCalls).toBe(0);
        expect(state.hardenCalls).toEqual([]);
        expect(state.disposed).toBe(true);
    });

    it('should refuse a foreign repository before creating the port', () => {
        const { dependencies, state } = coordinator(ORCHESTRATOR_USER_NODE_ID, 'someone/else');
        expect(() => coordinateRulesetHardening(true, dependencies)).toThrow(
            'refusing to operate on someone/else; expected jcosta33/sourdaw'
        );
        expect(state.portCalls).toBe(0);
        expect(state.disposed).toBe(true);
    });
});

describe('parseRulesetHardeningArgs', () => {
    it('should default to a dry run and accept --apply', () => {
        expect(parseRulesetHardeningArgs([])).toEqual({ apply: false, help: false });
        expect(parseRulesetHardeningArgs(['--apply'])).toEqual({ apply: true, help: false });
        expect(parseRulesetHardeningArgs(['--help'])).toEqual({ apply: false, help: true });
    });

    it('should refuse any other invocation', () => {
        for (const args of [['--apply', '--apply'], ['-a'], ['--force'], ['apply'], ['--help', '--apply']]) {
            expect(() => parseRulesetHardeningArgs(args), args.join(' ')).toThrow();
        }
        expect(() => parseRulesetHardeningArgs(['--apply', '--apply'])).toThrow(RULESET_HARDENING_USAGE);
        expect(() => parseRulesetHardeningArgs(['--help', '--apply'])).toThrow('--help takes no other arguments');
    });
});

describe('runRulesetHardeningCli', () => {
    function cliDependencies(actorNodeId = ORCHESTRATOR_USER_NODE_ID) {
        const applied: boolean[] = [];
        const session: GhSession = { configDir: '/tmp/sourdaw-ruleset', env: {}, dispose: () => undefined };
        const dependencies: RulesetHardeningCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateOrchestrator: () => ({ minted: { actorNodeId }, session }),
            repositoryName: () => 'jcosta33/sourdaw',
            port: () => fakePort(liveShape(), buildHardenedRuleset(liveShape())).port,
            harden: (apply, port) => {
                applied.push(apply);
                return hardenRuleset(apply, port);
            },
        };
        return { dependencies, applied };
    }

    it('should print the usage for --help and refuse malformed arguments', async () => {
        await expect(runRulesetHardeningCli(['--help'])).resolves.toBe(0);
        await expect(runRulesetHardeningCli(['--nope'])).rejects.toThrow(RULESET_HARDENING_USAGE);
    });

    it('should dry run by default and apply only with --apply', async () => {
        const { dependencies, applied } = cliDependencies();
        await expect(runRulesetHardeningCli([], dependencies)).resolves.toBe(0);
        await expect(runRulesetHardeningCli(['--apply'], dependencies)).resolves.toBe(0);
        expect(applied).toEqual([false, true]);
    });

    it('should refuse a non-orchestrator identity through the CLI', async () => {
        const { dependencies, applied } = cliDependencies(AUTHOR_BOT_NODE_ID);
        await expect(runRulesetHardeningCli(['--apply'], dependencies)).rejects.toThrow(
            `minted actor ${AUTHOR_BOT_NODE_ID} is not ${ORCHESTRATOR_USER_NODE_ID}`
        );
        expect(applied).toEqual([]);
    });
});

describe('ruleset REST helpers', () => {
    function recordingGh(respond: (args: string[], input?: string) => unknown) {
        const calls: { args: string[]; input?: string }[] = [];
        const gh = (args: string[], input?: string) => {
            calls.push(input === undefined ? { args } : { args, input });
            return JSON.stringify(respond(args, input));
        };
        return { gh, calls };
    }

    const LIST_ENTRY = {
        id: RULESET_ID,
        name: 'main',
        target: 'branch',
        source_type: 'Repository',
        source: REPOSITORY,
        enforcement: 'active',
    };

    it('should resolve the repository main branch ruleset id by name', () => {
        const { gh, calls } = recordingGh(() => [LIST_ENTRY]);
        expect(readMainRulesetId(REPOSITORY, gh)).toBe(RULESET_ID);
        expect(calls[0]?.args).toEqual(['api', `repos/${REPOSITORY}/rulesets?per_page=100`]);
    });

    it('should refuse a missing, inherited, ambiguous or unreadable main ruleset', () => {
        expect(() => readMainRulesetId(REPOSITORY, recordingGh(() => []).gh)).toThrow(
            `rulesets for ${REPOSITORY} carries no repository main branch ruleset`
        );
        expect(() =>
            readMainRulesetId(REPOSITORY, recordingGh(() => [{ ...LIST_ENTRY, source_type: 'Organization' }]).gh)
        ).toThrow('carries no repository main branch ruleset');
        expect(() => readMainRulesetId(REPOSITORY, recordingGh(() => [LIST_ENTRY, LIST_ENTRY]).gh)).toThrow(
            'carries 2 matching main rulesets'
        );
        expect(() => readMainRulesetId(REPOSITORY, recordingGh(() => ({})).gh)).toThrow(
            `rulesets for ${REPOSITORY} is not a readable ruleset list`
        );
        expect(() => readMainRulesetId(REPOSITORY, recordingGh(() => [{ ...LIST_ENTRY, id: 'nope' }]).gh)).toThrow(
            'returned an unreadable ruleset id'
        );
    });

    it('should read a ruleset by id and refuse another ruleset in the answer', () => {
        const { gh, calls } = recordingGh(() => fixture());
        expect(readRulesetById(REPOSITORY, RULESET_ID, gh)).toEqual(fixture());
        expect(calls[0]?.args).toEqual(['api', `repos/${REPOSITORY}/rulesets/${String(RULESET_ID)}`]);

        expect(() => readRulesetById(REPOSITORY, RULESET_ID, recordingGh(() => ({ id: 1 })).gh)).toThrow(
            `ruleset ${String(RULESET_ID)} for ${REPOSITORY} returned ruleset id 1`
        );
        expect(() => readRulesetById(REPOSITORY, RULESET_ID, recordingGh(() => [1]).gh)).toThrow(
            'is not a readable ruleset object'
        );
    });

    it('should PUT only the writable projection through stdin and check the receipt', () => {
        const hardened = buildHardenedRuleset(liveShape());
        const { gh, calls } = recordingGh(() => hardened);
        writeRulesetById(REPOSITORY, RULESET_ID, hardened, gh);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.args).toEqual([
            'api',
            '--method',
            'PUT',
            `repos/${REPOSITORY}/rulesets/${String(RULESET_ID)}`,
            '--input',
            '-',
        ]);
        const body: unknown = JSON.parse(calls[0]?.input ?? '{}');
        expect(body).toEqual(writableRuleset(hardened));
        expect(body).not.toHaveProperty('updated_at');
        expect(body).not.toHaveProperty('_links');

        expect(() => writeRulesetById(REPOSITORY, RULESET_ID, hardened, recordingGh(() => ({ id: 7 })).gh)).toThrow(
            `write ruleset ${String(RULESET_ID)} for ${REPOSITORY} did not record ruleset ${String(RULESET_ID)}`
        );
    });
});
