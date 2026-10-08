import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, type JsonValue } from '../canonicalRecord.ts';
import {
    CAPABILITY_PROPOSAL,
    buildCapabilityPlan,
    renderCapabilityPlan,
    type CapabilityObservation,
} from '../retargetCapabilityPlan.ts';

const SOURCE = 'a'.repeat(40);
const INTERVAL = { startedAt: '2026-10-08T00:00:00.000Z', endedAt: '2026-10-08T00:00:01.000Z' };

function observed(): CapabilityObservation {
    return {
        user: { id: 8978270, node_id: 'MDQ6VXNlcjg5NzgyNzA=', type: 'User', login: 'jcosta33' },
        repository: {
            id: 1183242917,
            node_id: 'R_kgDORobapQ',
            full_name: 'jcosta33/sourdaw',
            default_branch: 'main',
            permissions: { admin: true },
            owner: { id: 8978270, node_id: 'MDQ6VXNlcjg5NzgyNzA=', login: 'jcosta33', type: 'User' },
        },
        rulesets: [
            {
                id: 1,
                name: 'main',
                source: 'jcosta33/sourdaw',
                source_type: 'Repository',
                target: 'branch',
                enforcement: 'active',
                conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
                rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1 } }],
                bypass_actors: [],
            },
        ],
        classic: [],
        effectiveBranches: { main: [{ type: 'pull_request' }] },
        exactMainProtection: { required_status_checks: null },
        limitations: [],
    };
}

function requiredRuleset(observation: CapabilityObservation): CapabilityObservation['rulesets'][number] {
    const ruleset = observation.rulesets[0];
    if (ruleset === undefined) {
        throw new Error('test fixture is missing its main ruleset');
    }
    return ruleset;
}

describe('inactive retarget capability plan', () => {
    it('prints the exact disabled branch proposal and unchanged main rollback in canonical form', () => {
        const input = observed();
        const original = canonicalJson(requiredRuleset(input));
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.proposal).toEqual({
            name: 'native-publication-nonmain',
            target: 'branch',
            enforcement: 'disabled',
            conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/main'] } },
            bypass_actors: [{ actor_id: 8978270, actor_type: 'User', bypass_mode: 'always' }],
            rules: [{ type: 'creation' }, { type: 'update', parameters: { update_allows_fetch_and_merge: false } }],
        });
        expect(plan.activationEligible).toBe(false);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.originalMainRollback).toEqual([original]);
        expect(canonicalJson(requiredRuleset(input))).toBe(original);
        expect(plan.sourceSha).toBe(SOURCE);
        expect(plan.futureActorOperationIntent).toMatchObject({
            observedEnforcement: false,
            operatorUser: { actorId: 8978270, branchCreate: 'bypass-always' },
        });
        expect(plan.datedGrantEvidence).toMatchObject({
            artifact: 'retarget-installed-grants.json',
            currentGrantClaim: false,
        });
        expect(JSON.parse(renderCapabilityPlan(plan))).toEqual(plan);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it('changes the semantic digest when observed main protection changes', () => {
        const first = observed();
        const changed = observed();
        requiredRuleset(changed).rules = [{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }];
        expect(buildCapabilityPlan(first, SOURCE, INTERVAL).originalMainSemanticDigest).not.toBe(
            buildCapabilityPlan(changed, SOURCE, INTERVAL).originalMainSemanticDigest
        );
    });

    it('selects main rollback by include and exclude roles, not selector text', () => {
        const input = observed();
        const selected = requiredRuleset(input);
        selected.conditions = { ref_name: { include: ['refs/heads/main'], exclude: [] } };
        const excluded = {
            ...selected,
            id: 2,
            name: 'excluded',
            conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/main'] } },
        };
        const unrelated = {
            ...selected,
            id: 3,
            name: 'unrelated',
            conditions: { ref_name: { include: ['refs/heads/main-old'], exclude: [] } },
        };
        input.rulesets.push(excluded, unrelated);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.originalMainRollback).toEqual([canonicalJson(selected)]);
        expect(plan.completeObservedInventory).toBe(true);
        const changed = observed();
        changed.rulesets.splice(
            0,
            1,
            selected,
            { ...excluded, bypass_actors: [{ actor_id: 7, actor_type: 'User', bypass_mode: 'always' }] },
            unrelated
        );
        expect(buildCapabilityPlan(changed, SOURCE, INTERVAL).originalMainSemanticDigest).toBe(
            plan.originalMainSemanticDigest
        );
    });

    it('includes default branch policy but makes uncertain selectors incomplete', () => {
        const input = observed();
        const defaultRule = requiredRuleset(input);
        const knownDefault = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(knownDefault.originalMainRollback).toEqual([canonicalJson(defaultRule)]);
        expect(knownDefault.completeObservedInventory).toBe(true);
        expect(knownDefault.limitations).toEqual([]);
        const wildcard = { ...defaultRule, conditions: { ref_name: { include: ['refs/heads/m*'], exclude: [] } } };
        input.rulesets.splice(0, 1, wildcard);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('main ruleset applicability is unresolved');
        expect(plan.originalMainRollback).toEqual([canonicalJson(wildcard)]);
        expect(plan.baseline).toMatchObject({ rulesets: [wildcard] });
        expect(plan.activationEligible).toBe(false);
        const changed = observed();
        changed.rulesets.splice(0, 1, {
            ...wildcard,
            bypass_actors: [{ actor_id: 7, actor_type: 'User', bypass_mode: 'always' }],
        });
        expect(buildCapabilityPlan(changed, SOURCE, INTERVAL).originalMainSemanticDigest).not.toBe(
            plan.originalMainSemanticDigest
        );

        const unknownDefault = observed();
        unknownDefault.repository.default_branch = null;
        expect(() => buildCapabilityPlan(unknownDefault, SOURCE, INTERVAL)).toThrow(/default branch/u);
    });

    it('retains disabled and evaluate rulesets in main rollback visibility', () => {
        const input = observed();
        const original = requiredRuleset(input);
        const disabled = { ...original, id: 2, name: 'disabled-main', enforcement: 'disabled' };
        const evaluateRule = { ...original, id: 3, name: 'evaluate-main', enforcement: 'evaluate' };
        input.rulesets.push(disabled, evaluateRule);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.originalMainRollback).toEqual([original, disabled, evaluateRule].map(canonicalJson));
        expect(plan.completeObservedInventory).toBe(true);
    });

    it.each([
        [
            'user id',
            (o: CapabilityObservation) => {
                o.user.id = 1;
            },
        ],
        [
            'user node',
            (o: CapabilityObservation) => {
                o.user.node_id = 'another';
            },
        ],
        [
            'user type',
            (o: CapabilityObservation) => {
                o.user.type = 'Bot';
            },
        ],
        [
            'repository',
            (o: CapabilityObservation) => {
                o.repository.node_id = 'another';
            },
        ],
        [
            'default branch',
            (o: CapabilityObservation) => {
                o.repository.default_branch = 'trunk';
            },
        ],
    ])('refuses a changed %s', (_label, mutate) => {
        const input = observed();
        mutate(input);
        expect(() => buildCapabilityPlan(input, SOURCE, INTERVAL)).toThrow(/identity|default branch/u);
    });

    it('refuses a same-name collision and unsafe policy value', () => {
        const collision = observed();
        requiredRuleset(collision).name = 'native-publication-nonmain';
        expect(() => buildCapabilityPlan(collision, SOURCE, INTERVAL)).toThrow(/already exists/u);
        const secret = observed();
        requiredRuleset(secret).name = ['ghp', '_secret'].join('');
        expect(() => buildCapabilityPlan(secret, SOURCE, INTERVAL)).toThrow(/unsafe value/u);
    });

    it('preserves incomplete visibility and unknown semantics without making an activation claim', () => {
        const input = observed();
        const mainRuleset = requiredRuleset(input);
        delete mainRuleset.bypass_actors;
        mainRuleset.rules = [{ type: 'future_rule' }];
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('ruleset detail or bypass visibility is incomplete');
        expect(plan.activationEligible).toBe(false);
    });

    it('marks present unreadable required status checks incomplete while accepting optional parameters and valid arrays', () => {
        const malformed = observed();
        requiredRuleset(malformed).rules = [
            {
                type: 'required_status_checks',
                parameters: { strict_required_status_checks_policy: false, required_status_checks: null },
            },
        ];
        const incomplete = buildCapabilityPlan(malformed, SOURCE, INTERVAL);
        expect(incomplete.completeObservedInventory).toBe(false);
        expect(incomplete.limitations).toContain('an applicable ruleset has incomplete required status checks');
        expect(incomplete.activationEligible).toBe(false);

        const optional = observed();
        requiredRuleset(optional).rules = [{ type: 'required_status_checks' }];
        expect(buildCapabilityPlan(optional, SOURCE, INTERVAL).completeObservedInventory).toBe(true);

        const valid = observed();
        requiredRuleset(valid).rules = [
            {
                type: 'required_status_checks',
                parameters: {
                    strict_required_status_checks_policy: false,
                    required_status_checks: [{ context: 'Gate' }],
                    do_not_enforce_on_create: false,
                },
            },
        ];
        expect(buildCapabilityPlan(valid, SOURCE, INTERVAL).completeObservedInventory).toBe(true);
    });

    const malformedRequiredCheckParameters: JsonValue[] = [
        { required_status_checks: [] },
        { strict_required_status_checks_policy: 'false', required_status_checks: [] },
        { strict_required_status_checks_policy: false, required_status_checks: [{}] },
        { strict_required_status_checks_policy: false, required_status_checks: [null] },
        { strict_required_status_checks_policy: false, do_not_enforce_on_create: 'false', required_status_checks: [] },
    ];
    it.each(malformedRequiredCheckParameters)(
        'marks an unreadable present required-check value incomplete',
        (parameters) => {
            const input = observed();
            requiredRuleset(input).rules = [{ type: 'required_status_checks', parameters }];
            const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
            expect(plan.completeObservedInventory).toBe(false);
            expect(plan.limitations).toContain('an applicable ruleset has incomplete required status checks');
        }
    );

    it('refuses any altered or enabled proposal at render time', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        plan.activationEligible = true;
        expect(() => renderCapabilityPlan(plan)).toThrow(/inactive proposal/u);
    });

    it('keeps the expected disabled proposal and its digest independent from a returned plan', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        const expected = canonicalJson(CAPABILITY_PROPOSAL);
        const digest = createHash('sha256').update(expected).digest('hex');
        const proposal = plan.proposal;
        if (proposal === null || Array.isArray(proposal) || typeof proposal !== 'object') {
            throw new Error('test fixture has no proposal object');
        }
        proposal.enforcement = 'active';
        expect(plan.activationEligible).toBe(false);
        expect(() => renderCapabilityPlan(plan)).toThrow(/inactive proposal/u);
        expect(canonicalJson(CAPABILITY_PROPOSAL)).toBe(expected);
        expect(plan.proposalDigest).toBe(digest);

        const changedDigest = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        changedDigest.proposalDigest = '0'.repeat(64);
        expect(() => renderCapabilityPlan(changedDigest)).toThrow(/inactive proposal/u);
    });
});
