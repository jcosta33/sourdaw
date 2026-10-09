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
        exactMainProtection: {
            url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
            required_status_checks: null,
            enforce_admins: { enabled: false },
            required_pull_request_reviews: null,
            restrictions: null,
        },
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

function requiredRecord(value: JsonValue | undefined): Record<string, JsonValue> {
    if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error('test fixture requires a record');
    }
    return value;
}

function firstRecord(value: JsonValue | undefined): Record<string, JsonValue> {
    if (!Array.isArray(value) || value[0] === undefined) {
        throw new Error('test fixture requires a nonempty array');
    }
    return requiredRecord(value[0]);
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

    it('detaches all captured observation fields before deriving digests and rollback', () => {
        const input = observed();
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        const emitted = renderCapabilityPlan(plan);
        const baselineDigest = plan.baselineDigest;
        const mainDigest = plan.originalMainSemanticDigest;
        const rollback = plan.originalMainRollback;
        requiredRuleset(input).rules = [{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }];
        requiredRuleset(input).bypass_actors = [{ actor_id: 7, actor_type: 'User', bypass_mode: 'always' }];
        input.classic.push({ pattern: 'release/*' });
        const effectiveMain = input.effectiveBranches.main;
        if (effectiveMain === undefined) {
            throw new Error('test fixture is missing effective main rules');
        }
        effectiveMain.push({ type: 'required_status_checks' });
        const protection = input.exactMainProtection;
        if (protection === null || Array.isArray(protection) || typeof protection !== 'object') {
            throw new Error('test fixture is missing exact main protection');
        }
        protection.required_status_checks = { contexts: ['changed'] };
        input.limitations.push('later source mutation');
        expect(renderCapabilityPlan(plan)).toBe(emitted);
        expect(plan.baselineDigest).toBe(baselineDigest);
        expect(plan.originalMainSemanticDigest).toBe(mainDigest);
        expect(plan.originalMainRollback).toEqual(rollback);
        expect(plan.activationEligible).toBe(false);
    });

    it('refuses a returned baseline whose review requirement changed after derivation', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        const rule = firstRecord(requiredRecord(plan.baseline).rulesets);
        const pullRequest = firstRecord(rule.rules);
        requiredRecord(pullRequest.parameters).required_approving_review_count = 0;
        expect(() => renderCapabilityPlan(plan)).toThrow(/evidence.*changed/u);
    });

    it('refuses a returned rollback changed independently from its baseline', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        plan.originalMainRollback = [];
        expect(() => renderCapabilityPlan(plan)).toThrow(/evidence.*changed/u);
    });

    it.each(['baselineDigest', 'originalMainSemanticDigest'] as const)(
        'refuses a returned %s changed independently from evidence',
        (field) => {
            const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
            plan[field] = '0'.repeat(64);
            expect(() => renderCapabilityPlan(plan)).toThrow(/evidence.*changed/u);
        }
    );

    it('refuses returned completeness or limitations changed independently from the baseline', () => {
        const incomplete = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        incomplete.completeObservedInventory = false;
        expect(() => renderCapabilityPlan(incomplete)).toThrow(/evidence.*changed/u);
        const alteredLimitations = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        alteredLimitations.limitations = ['fabricated limitation'];
        expect(() => renderCapabilityPlan(alteredLimitations)).toThrow(/evidence.*changed/u);
    });

    it('refuses a returned source changed after capture while its evidence digests stay fixed', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        plan.sourceSha = 'b'.repeat(40);
        expect(() => renderCapabilityPlan(plan)).toThrow(/evidence.*changed/u);
    });

    it('refuses a returned observation interval changed after capture while its evidence digests stay fixed', () => {
        const plan = buildCapabilityPlan(observed(), SOURCE, INTERVAL);
        requiredRecord(plan.observedAt).startedAt = '2026-10-08T00:00:00.500Z';
        expect(() => renderCapabilityPlan(plan)).toThrow(/evidence.*changed/u);
    });

    it.each(['detail', 'effective'] as const)(
        'marks absent required-check parameters in %s policy incomplete',
        (surface) => {
            const input = observed();
            if (surface === 'detail') {
                requiredRuleset(input).rules = [{ type: 'required_status_checks' }];
            } else {
                input.effectiveBranches.main = [{ type: 'required_status_checks' }];
            }
            const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
            expect(plan.completeObservedInventory).toBe(false);
            expect(plan.limitations).toContain('an applicable ruleset has incomplete required status checks');
            expect(plan.activationEligible).toBe(false);
        }
    );

    it('keeps parameterless rules without required checks readable', () => {
        const input = observed();
        requiredRuleset(input).rules = [{ type: 'pull_request' }];
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    const unreadableEffectiveMain: JsonValue[][] = [
        [
            {
                type: 'required_status_checks',
                parameters: { strict_required_status_checks_policy: false, required_status_checks: null },
            },
        ],
        [false],
        [{}],
        [{ type: 'unrecognized_policy_rule' }],
    ];
    it.each(unreadableEffectiveMain.map((rules) => ({ rules })))(
        'never certifies an unreadable effective-main rule',
        ({ rules }) => {
            const input = observed();
            input.effectiveBranches.main = rules;
            let plan;
            try {
                plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                return;
            }
            expect(plan.completeObservedInventory).toBe(false);
            expect(plan.limitations).toEqual(expect.arrayContaining([expect.any(String)]));
        }
    );

    it('retains completeness for valid effective-main required checks', () => {
        const input = observed();
        input.effectiveBranches.main = [
            {
                type: 'required_status_checks',
                parameters: { strict_required_status_checks_policy: false, required_status_checks: [] },
            },
        ];
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
    });

    const unreadableProtection: JsonValue[] = [
        null,
        false,
        [],
        {},
        { unrelated: true },
        { url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection' },
        {
            url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
            required_status_checks: null,
        },
        {
            url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
            required_status_checks: {},
            enforce_admins: {},
            required_pull_request_reviews: {},
            restrictions: {},
        },
    ];
    it.each(unreadableProtection)(
        'marks an unreadable exact-main protection response incomplete',
        (exactMainProtection) => {
            const input: CapabilityObservation = { ...observed(), exactMainProtection };
            const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
            expect(plan.completeObservedInventory).toBe(false);
            expect(plan.limitations).toContain('exact main classic protection is incomplete');
            expect(plan.activationEligible).toBe(false);
        }
    );

    it('accepts a structured exact-main protection response with populated policy sections', () => {
        const input: CapabilityObservation = {
            ...observed(),
            exactMainProtection: {
                url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
                required_status_checks: { contexts: ['Gate'], enforcement_level: 'non_admins' },
                enforce_admins: { enabled: true },
                required_pull_request_reviews: { required_approving_review_count: 1 },
                restrictions: { users: [], teams: [], apps: [] },
            },
        };
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
        expect(plan.activationEligible).toBe(false);
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

    it('marks unreadable required status checks incomplete while accepting unrelated parameterless rules and valid arrays', () => {
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
        requiredRuleset(optional).rules = [{ type: 'pull_request' }];
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
