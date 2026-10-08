import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../canonicalRecord.ts';
import { buildCapabilityPlan, renderCapabilityPlan, type CapabilityObservation } from '../retargetCapabilityPlan.ts';

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

describe('inactive retarget capability plan', () => {
    it('prints the exact disabled branch proposal and unchanged main rollback in canonical form', () => {
        const input = observed();
        const original = canonicalJson(input.rulesets[0]);
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
        expect(canonicalJson(input.rulesets[0])).toBe(original);
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
        changed.rulesets[0].rules = [{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }];
        expect(buildCapabilityPlan(first, SOURCE, INTERVAL).originalMainSemanticDigest).not.toBe(
            buildCapabilityPlan(changed, SOURCE, INTERVAL).originalMainSemanticDigest
        );
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
        collision.rulesets[0].name = 'native-publication-nonmain';
        expect(() => buildCapabilityPlan(collision, SOURCE, INTERVAL)).toThrow(/already exists/u);
        const secret = observed();
        secret.rulesets[0].name = ['ghp', '_secret'].join('');
        expect(() => buildCapabilityPlan(secret, SOURCE, INTERVAL)).toThrow(/unsafe value/u);
    });

    it('preserves incomplete visibility and unknown semantics without making an activation claim', () => {
        const input = observed();
        delete input.rulesets[0].bypass_actors;
        input.rulesets[0].rules = [{ type: 'future_rule' }];
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('ruleset detail or bypass visibility is incomplete');
        expect(plan.activationEligible).toBe(false);
    });

    it('refuses any altered or enabled proposal at render time', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        plan.activationEligible = true;
        expect(() => renderCapabilityPlan(plan)).toThrow(/inactive proposal/u);
    });
});
