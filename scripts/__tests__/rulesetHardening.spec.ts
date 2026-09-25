import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
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
    swappedLifecycleRules?: boolean;
};

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
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: false,
            required_status_checks: (overrides.contexts ?? ['Gate']).map((context) => ({ context })),
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

/**
 * The live `main` shape this command is meant to find: the two head-discipline booleans already hold
 * (#3002) and the approving-review count is still 2, awaiting the single-approval change.
 */
function liveShape(): RulesetDocument {
    return fixture({ dismissStaleReviews: true, requireLastPushApproval: true });
}

function rulesetWithoutApprovedFields(): RulesetDocument {
    return {
        name: 'main',
        rules: [{ type: 'pull_request', parameters: {} }],
    };
}

type FakePort = {
    port: RulesetHardeningPort;
    writes: { rulesetId: number; ruleset: RulesetDocument }[];
    reads: number[];
    logs: string[];
};

/** A port double that answers the first read with `live`, every later read with `readback`. */
function fakePort(live: RulesetDocument, readback: RulesetDocument = live): FakePort {
    const writes: { rulesetId: number; ruleset: RulesetDocument }[] = [];
    const reads: number[] = [];
    const logs: string[] = [];
    return {
        port: {
            resolveRulesetId: () => RULESET_ID,
            readRuleset: (rulesetId) => {
                reads.push(rulesetId);
                return reads.length === 1 ? live : readback;
            },
            writeRuleset: (rulesetId, ruleset) => {
                writes.push({ rulesetId, ruleset });
            },
            log: (message) => {
                logs.push(message);
            },
        },
        writes,
        reads,
        logs,
    };
}

describe('HARDENING_TARGETS', () => {
    it('should name exactly the approved head-discipline fields and their targets', () => {
        expect(HARDENING_TARGETS).toEqual([
            { field: 'dismiss_stale_reviews_on_push', to: true },
            { field: 'require_last_push_approval', to: true },
            { field: 'required_approving_review_count', to: 1 },
        ]);
        expect(HARDENING_TARGETS).toHaveLength(3);
    });
});

describe('planHardening', () => {
    it('should report exactly the review count unsatisfied on the live shape', () => {
        const plan = planHardening(liveShape());
        expect(plan.ruleIndex).toBe(PULL_REQUEST_INDEX);
        expect(plan.satisfied).toBe(false);
        expect(plan.changes).toEqual([
            {
                field: 'dismiss_stale_reviews_on_push',
                path: 'rules[2].parameters.dismiss_stale_reviews_on_push',
                satisfied: true,
                from: true,
                to: true,
            },
            {
                field: 'require_last_push_approval',
                path: 'rules[2].parameters.require_last_push_approval',
                satisfied: true,
                from: true,
                to: true,
            },
            {
                field: 'required_approving_review_count',
                path: 'rules[2].parameters.required_approving_review_count',
                satisfied: false,
                from: 2,
                to: 1,
            },
        ]);
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
        const plan = planHardening(
            fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 })
        );
        expect(plan.satisfied).toBe(true);
        expect(plan.changes.every((change) => change.satisfied)).toBe(true);
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
        ]);
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
});

describe('buildHardenedRuleset', () => {
    it('should set every approved field to its target and alter nothing else', () => {
        const live = liveShape();
        const hardened = buildHardenedRuleset(live);
        expect(hardened).toEqual(fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 }));
        expect(hardened).not.toBe(live);
        expect(hardened.rules).not.toBe(live.rules);
    });

    it('should leave its input unmutated', () => {
        const live = liveShape();
        buildHardenedRuleset(live);
        expect(live).toEqual(liveShape());
        expect(live).not.toEqual(fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 }));
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
            ],
        });
    });

    it('should pass its own approved-set guard and differ only at the approved paths', () => {
        const live = liveShape();
        expect(() => assertOnlyApprovedFieldsChanged(live, buildHardenedRuleset(live))).not.toThrow();
        expect(() => assertTargetsSatisfied(buildHardenedRuleset(live))).not.toThrow();
        expect(rulesetDifferences(live, buildHardenedRuleset(live)).sort()).toEqual([
            'rules[2].parameters.required_approving_review_count',
        ]);
    });
});

describe('assertOnlyApprovedFieldsChanged', () => {
    const before = liveShape();

    const REFUSED: { label: string; after: RulesetDocument; path: string }[] = [
        {
            label: 'require_code_owner_review',
            after: fixture({ dismissStaleReviews: true, requireLastPushApproval: true, requireCodeOwnerReview: true }),
            path: 'rules[2].parameters.require_code_owner_review',
        },
        {
            label: 'allowed_merge_methods',
            after: fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                mergeMethods: ['squash', 'merge'],
            }),
            path: 'rules[2].parameters.allowed_merge_methods[1]',
        },
        {
            label: 'required_reviewers',
            after: fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                requiredReviewers: [{ id: 1, name: 'reviewer' }],
            }),
            path: 'rules[2].parameters.required_reviewers[0]',
        },
        {
            label: 'conditions',
            after: fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                conditions: { ref_name: { exclude: [], include: ['main'] } },
            }),
            path: 'conditions.ref_name.include[0]',
        },
        {
            label: 'bypass actors',
            after: fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                bypassActors: [{ actor_id: 1, actor_type: 'Team', bypass_mode: 'always' }],
            }),
            path: 'bypass_actors[0]',
        },
        {
            label: 'rule order',
            after: fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                swappedLifecycleRules: true,
            }),
            path: 'rules[0].type',
        },
    ];

    it.each(REFUSED)('should refuse a $label change naming $path', ({ after, path }) => {
        expect(() => assertOnlyApprovedFieldsChanged(before, after)).toThrow(path);
    });

    it('should allow a pair that differs only in the approved fields', () => {
        expect(() => assertOnlyApprovedFieldsChanged(before, buildHardenedRuleset(before))).not.toThrow();
        expect(() => assertOnlyApprovedFieldsChanged(before, before)).not.toThrow();
    });

    it('should name the approved set in the refusal', () => {
        const after = fixture({
            dismissStaleReviews: true,
            requireLastPushApproval: true,
            requireCodeOwnerReview: true,
        });
        expect(() => assertOnlyApprovedFieldsChanged(before, after)).toThrow(
            'refusing ruleset change outside the approved set dismiss_stale_reviews_on_push, require_last_push_approval, required_approving_review_count'
        );
    });

    /**
     * The mutation probe for this slice's guard: an approved field changing must not hide an illegal
     * change later in the walk. Changing the review count to 1 (now approved) alongside an illegal
     * `require_code_owner_review` change must still refuse the illegal path, not pass on the count.
     */
    it('should refuse an approved count change that also carries an illegal change', () => {
        const after = fixture({
            dismissStaleReviews: true,
            requireLastPushApproval: true,
            reviewCount: 1,
            requireCodeOwnerReview: true,
        });
        const differences = rulesetDifferences(before, after);
        expect(differences).toContain('rules[2].parameters.required_approving_review_count');
        expect(differences).toContain('rules[2].parameters.require_code_owner_review');
        expect(() => assertOnlyApprovedFieldsChanged(before, after)).toThrow(
            'rules[2].parameters.require_code_owner_review'
        );
    });
});

describe('assertTargetsSatisfied', () => {
    it('should refuse a ruleset that leaves an approved field short of its target, naming the path', () => {
        expect(() =>
            assertTargetsSatisfied(
                fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 5 })
            )
        ).toThrow('rules[2].parameters.required_approving_review_count');
        expect(() =>
            assertTargetsSatisfied(
                fixture({ dismissStaleReviews: false, requireLastPushApproval: true, reviewCount: 1 })
            )
        ).toThrow('rules[2].parameters.dismiss_stale_reviews_on_push');
    });

    it('should accept a ruleset where every field holds its target', () => {
        expect(() =>
            assertTargetsSatisfied(
                fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 })
            )
        ).not.toThrow();
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
        expect(rollback).toContain('"required_approving_review_count":2');
        expect(rollback).not.toContain('"required_approving_review_count":1');
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
    it('should write once with the review count at 1 and nothing else changed, then read back', () => {
        const live = liveShape();
        const hardened = buildHardenedRuleset(live);
        const { port, writes, reads } = fakePort(live, hardened);
        const receipt = hardenRuleset(true, port);
        expect(receipt).toEqual({
            rulesetId: RULESET_ID,
            outcome: 'applied',
            changed: ['required_approving_review_count'],
            rollback: captureRollback(live),
        });
        expect(writes).toHaveLength(1);
        expect(writes[0]).toEqual({ rulesetId: RULESET_ID, ruleset: hardened });
        expect(reads).toEqual([RULESET_ID, RULESET_ID]);
        expect(writes[0]?.ruleset).toEqual(
            fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 })
        );
    });

    it('should capture the rollback and log it before writing', () => {
        const live = liveShape();
        const hardened = buildHardenedRuleset(live);
        const { port, logs } = fakePort(live, hardened);
        hardenRuleset(true, port);
        expect(logs).toEqual([
            `ruleset-rollback:${String(RULESET_ID)}:${captureRollback(live)}`,
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
            changed: ['required_approving_review_count'],
            rollback: captureRollback(live),
        });
        expect(writes).toEqual([]);
        expect(reads).toEqual([RULESET_ID]);
        expect(logs).toEqual([
            'ruleset-hardening-plan:rules[2].parameters.dismiss_stale_reviews_on_push:true->true',
            'ruleset-hardening-plan:rules[2].parameters.require_last_push_approval:true->true',
            'ruleset-hardening-plan:rules[2].parameters.required_approving_review_count:2->1',
            `ruleset-hardening:${String(RULESET_ID)}:dry-run:required_approving_review_count`,
        ]);
    });

    it('should write nothing and say so when every field already holds', () => {
        const live = fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 1 });
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

    it('should refuse a candidate that adds the shadow context before any write', () => {
        const live = liveShape();
        const { port, writes } = fakePort(live, buildHardenedRuleset(live));
        const build = () =>
            fixture({
                dismissStaleReviews: true,
                requireLastPushApproval: true,
                contexts: ['Gate', SHADOW_CONTEXT],
            });
        expect(() => hardenRuleset(true, port, build)).toThrow(SHADOW_CONTEXT);
        expect(writes).toEqual([]);
    });

    it('should refuse a candidate that leaves the review count at a value other than 1 before any write', () => {
        const live = liveShape();
        const { port, writes } = fakePort(live, buildHardenedRuleset(live));
        const build = () => fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 5 });
        expect(() => hardenRuleset(true, port, build)).toThrow('rules[2].parameters.required_approving_review_count');
        expect(writes).toEqual([]);
    });

    it('should refuse a readback that added a required context', () => {
        const live = liveShape();
        const readback = fixture({
            dismissStaleReviews: true,
            requireLastPushApproval: true,
            contexts: ['Gate', 'CI'],
        });
        const { port, writes } = fakePort(live, readback);
        expect(() => hardenRuleset(true, port)).toThrow('refusing ruleset change that requires status context(s): CI');
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that stored the review count at a value other than 1', () => {
        const live = liveShape();
        const readback = fixture({ dismissStaleReviews: true, requireLastPushApproval: true, reviewCount: 3 });
        const { port, writes } = fakePort(live, readback);
        expect(() => hardenRuleset(true, port)).toThrow('rules[2].parameters.required_approving_review_count');
        expect(writes).toHaveLength(1);
    });

    it('should refuse a readback that never applied the review-count target', () => {
        const live = liveShape();
        const { port } = fakePort(live, live);
        expect(() => hardenRuleset(true, port)).toThrow('rules[2].parameters.required_approving_review_count');
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
