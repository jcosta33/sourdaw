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
const PULL_REQUEST_PARAMETERS = {
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: true,
    required_approving_review_count: 1,
    required_review_thread_resolution: true,
};

function effectiveRule(rule: Record<string, JsonValue>): Record<string, JsonValue> {
    return { ...rule, ruleset_id: 1, ruleset_source_type: 'Repository', ruleset_source: 'jcosta33/sourdaw' };
}

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
                rules: [{ type: 'pull_request', parameters: structuredClone(PULL_REQUEST_PARAMETERS) }],
                bypass_actors: [],
            },
        ],
        classic: [],
        effectiveBranches: {
            main: [effectiveRule({ type: 'pull_request', parameters: structuredClone(PULL_REQUEST_PARAMETERS) })],
        },
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
        const inactiveClaims = {
            atomicServerSnapshot: false,
            repairedDestinationBoundary: false,
            operatorGrantPresent: false,
        };
        expect(plan.claims).toEqual(inactiveClaims);
        const rendered: JsonValue = JSON.parse(renderCapabilityPlan(plan));
        expect(rendered).toEqual(plan);
        expect(requiredRecord(rendered).claims).toEqual(inactiveClaims);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it.each([
        ['always', 'User', 7],
        ['pull_request', 'User', 7],
        ['exempt', 'User', 7],
        ['always', 'DeployKey', null],
    ] as const)('accepts supported bypass actor semantics %s/%s', (bypass_mode, actor_type, actor_id) => {
        const input = observed();
        requiredRuleset(input).bypass_actors = [{ actor_id, actor_type, bypass_mode }];

        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);

        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
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

    it.each(['creation', 'deletion', 'required_linear_history', 'required_signatures', 'non_fast_forward'])(
        'keeps the parameterless %s rule readable',
        (type) => {
            const input = observed();
            requiredRuleset(input).rules = [{ type }];
            input.effectiveBranches.main = [effectiveRule({ type })];
            const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
            expect(plan.completeObservedInventory).toBe(true);
            expect(plan.limitations).toEqual([]);
            expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
        }
    );

    const requiredParameterRules: Array<{ type: string; parameters: Record<string, JsonValue> }> = [
        { type: 'update', parameters: { update_allows_fetch_and_merge: false } },
        { type: 'pull_request', parameters: PULL_REQUEST_PARAMETERS },
        {
            type: 'required_status_checks',
            parameters: { strict_required_status_checks_policy: false, required_status_checks: [] },
        },
    ];
    const incompleteParameterRules = requiredParameterRules.flatMap<Record<string, JsonValue>>(
        ({ type, parameters }) => [
            { type },
            { type, parameters: {} },
            ...Object.keys(parameters).map((field) => ({
                type,
                parameters: Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== field)),
            })),
        ]
    );
    it.each(
        (['detail', 'effective'] as const).flatMap((surface) =>
            incompleteParameterRules.map((rule) => ({ surface, rule }))
        )
    )('does not certify missing required parameters on $surface: $rule', ({ surface, rule }) => {
        const input = observed();
        if (surface === 'detail') {
            requiredRuleset(input).rules = [rule];
        } else {
            input.effectiveBranches.main = [effectiveRule(rule)];
        }
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContainEqual(expect.stringContaining('incomplete required'));
        expect(requiredRecord(plan.baseline)).toEqual(input);
        expect(plan.activationEligible).toBe(false);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    const unsupportedParameterizedTypes = [
        'commit_message_pattern',
        'commit_author_email_pattern',
        'committer_email_pattern',
        'branch_name_pattern',
        'required_deployments',
        'required_code_scanning',
        'required_workflows',
        'merge_queue',
        'file_path_restriction',
        'max_file_path_length',
        'file_extension_restriction',
        'max_file_size',
        'copilot_code_review',
    ];
    it.each(
        (['detail', 'effective'] as const).flatMap((surface) =>
            unsupportedParameterizedTypes.flatMap((type) => {
                const withoutParameters: Record<string, JsonValue> = { type };
                const emptyParameters: Record<string, JsonValue> = { type, parameters: {} };
                return [
                    { surface, rule: withoutParameters },
                    { surface, rule: emptyParameters },
                ];
            })
        )
    )('does not infer unsupported $surface parameter semantics: $rule', ({ surface, rule }) => {
        const input = observed();
        if (surface === 'detail') {
            requiredRuleset(input).rules = [rule];
        } else {
            input.effectiveBranches.main = [effectiveRule(rule)];
        }
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('an applicable ruleset has unknown parameter semantics');
        expect(requiredRecord(plan.baseline)).toEqual(input);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    const unsupportedParameterValues: Array<{ type: string; parameters: Record<string, JsonValue> }> = [
        { type: 'update', parameters: { update_allows_fetch_and_merge: 'false' } },
        ...[
            'dismiss_stale_reviews_on_push',
            'require_code_owner_review',
            'require_last_push_approval',
            'required_review_thread_resolution',
        ].map((field) => ({ type: 'pull_request', parameters: { [field]: 'false' } })),
        ...[-1, 11, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map((value) => ({
            type: 'pull_request',
            parameters: { required_approving_review_count: value },
        })),
        ...[[], ['unrecognized-merge-method'], ['squash', 'unknown'], 'squash', [false], null].map((value) => ({
            type: 'pull_request',
            parameters: { allowed_merge_methods: value },
        })),
    ];
    it.each(
        (['detail', 'effective'] as const).flatMap((surface) =>
            unsupportedParameterValues.map((rule) => ({ surface, rule }))
        )
    )('does not certify unsupported $surface parameter values: $rule', ({ surface, rule }) => {
        const input = observed();
        if (surface === 'detail') {
            requiredRuleset(input).rules = [rule];
        } else {
            input.effectiveBranches.main = [rule];
        }
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('an applicable ruleset has unsupported parameter values');
        expect(plan.activationEligible).toBe(false);
        expect(requiredRecord(plan.baseline)).toEqual(input);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it('accepts supported required and optional parameter values on both policy surfaces', () => {
        const input = observed();
        const rules: JsonValue[] = [
            { type: 'update', parameters: { update_allows_fetch_and_merge: false } },
            {
                type: 'pull_request',
                parameters: {
                    dismiss_stale_reviews_on_push: true,
                    require_code_owner_review: false,
                    require_last_push_approval: true,
                    required_review_thread_resolution: false,
                    required_approving_review_count: 0,
                    allowed_merge_methods: ['merge', 'squash', 'rebase'],
                },
            },
        ];
        requiredRuleset(input).rules = rules;
        input.effectiveBranches.main = rules.map((rule) => effectiveRule(requiredRecord(rule)));
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
    });

    it.each(['push', 'tag'] as const)('retains an unparsed %s ruleset without certifying its policy', (target) => {
        const input = observed();
        const extra = {
            ...requiredRuleset(input),
            id: 2,
            name: 'other-policy',
            target,
            rules: [{ type: 'future_push_restriction' }],
            bypass_actors: [{ actor_id: 7, actor_type: 'UnknownActor', bypass_mode: 'always' }],
        };
        input.rulesets.push(extra);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('non-branch ruleset semantics are unsupported');
        expect(requiredRecord(plan.baseline).rulesets).toEqual(input.rulesets);
        expect(plan.originalMainRollback).toEqual([canonicalJson(requiredRuleset(input))]);
        expect(plan.activationEligible).toBe(false);
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
        const rules = [
            {
                type: 'required_status_checks',
                parameters: { strict_required_status_checks_policy: false, required_status_checks: [] },
            },
        ];
        requiredRuleset(input).rules = rules;
        input.effectiveBranches.main = rules.map(effectiveRule);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
    });

    const invalidEffectiveSources: Array<{ label: string; source: Record<string, JsonValue> }> = [
        { label: 'absent provenance', source: {} },
        { label: 'missing ID', source: { ruleset_source_type: 'Repository', ruleset_source: 'jcosta33/sourdaw' } },
        ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null].map((ruleset_id) => ({
            label: `invalid ID ${String(ruleset_id)}`,
            source: { ruleset_id, ruleset_source_type: 'Repository', ruleset_source: 'jcosta33/sourdaw' },
        })),
        { label: 'missing source type', source: { ruleset_id: 1, ruleset_source: 'jcosta33/sourdaw' } },
        { label: 'missing source name', source: { ruleset_id: 1, ruleset_source_type: 'Repository' } },
        {
            label: 'unlisted organization policy',
            source: { ruleset_id: 999, ruleset_source_type: 'Organization', ruleset_source: 'unlisted-organization' },
        },
        {
            label: 'different source type',
            source: { ruleset_id: 1, ruleset_source_type: 'Organization', ruleset_source: 'jcosta33/sourdaw' },
        },
        {
            label: 'different source name',
            source: { ruleset_id: 1, ruleset_source_type: 'Repository', ruleset_source: 'another/repository' },
        },
    ];
    it.each(
        ['main', 'agent/retarget-capability-planner', 'release/v1.0', 'Case.Mixed'].flatMap((branch) =>
            invalidEffectiveSources.map(({ label, source }) => ({ branch, label, source }))
        )
    )('does not certify $label on $branch', ({ branch, source }) => {
        const input = observed();
        input.effectiveBranches[branch] = [{ type: 'pull_request', parameters: PULL_REQUEST_PARAMETERS, ...source }];
        const raw = canonicalJson(input);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('effective rule source is not bound to captured ruleset detail');
        expect(canonicalJson(plan.baseline ?? null)).toBe(raw);
        expect(plan.originalMainRollback).toEqual([canonicalJson(requiredRuleset(input))]);
        expect(plan.sourceSha).toBe(SOURCE);
        expect(plan.activationEligible).toBe(false);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it.each([
        { label: 'different rule type', rules: [{ type: 'deletion' }] },
        {
            label: 'different required parameter',
            rules: [
                { type: 'pull_request', parameters: { ...PULL_REQUEST_PARAMETERS, require_last_push_approval: false } },
            ],
        },
        {
            label: 'unobserved optional default',
            rules: [
                { type: 'pull_request', parameters: { ...PULL_REQUEST_PARAMETERS, allowed_merge_methods: ['squash'] } },
            ],
        },
        {
            label: 'ambiguous duplicate rule',
            rules: [
                { type: 'pull_request', parameters: PULL_REQUEST_PARAMETERS },
                { type: 'pull_request', parameters: PULL_REQUEST_PARAMETERS },
            ],
        },
    ])('does not join an effective rule to $label in its captured source', ({ rules }) => {
        const input = observed();
        requiredRuleset(input).rules = rules;
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('effective rule semantics do not match captured ruleset detail');
        expect(requiredRecord(plan.baseline)).toEqual(input);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it.each([
        { label: 'missing bypass detail', change: { bypass_actors: null } },
        { label: 'disabled detail', change: { enforcement: 'disabled' } },
        { label: 'evaluate detail', change: { enforcement: 'evaluate' } },
        { label: 'tag detail', change: { target: 'tag' } },
        { label: 'push detail', change: { target: 'push' } },
        { label: 'changed detail source', change: { source: 'another/repository' } },
        { label: 'changed detail source type', change: { source_type: 'Organization' } },
    ])('does not bind an effective rule to $label', ({ change }) => {
        const input = observed();
        Object.assign(requiredRuleset(input), change);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('effective rule source is not bound to captured ruleset detail');
        expect(requiredRecord(plan.baseline)).toEqual(input);
    });

    it('refuses duplicate captured source IDs before an ambiguous effective join', () => {
        const input = observed();
        input.rulesets.push({ ...requiredRuleset(input), name: 'another-name', source: 'another/repository' });
        expect(() => buildCapabilityPlan(input, SOURCE, INTERVAL)).toThrow('duplicate ruleset id');
    });

    it('binds multiple effective rules on every branch to the same complete source without rewriting raw observations', () => {
        const input = observed();
        const rules: Array<Record<string, JsonValue>> = [
            { type: 'pull_request', parameters: PULL_REQUEST_PARAMETERS },
            { type: 'update', parameters: { update_allows_fetch_and_merge: false } },
            { type: 'deletion' },
        ];
        requiredRuleset(input).conditions = { ref_name: { include: ['~ALL'], exclude: [] } };
        requiredRuleset(input).rules = rules;
        for (const branch of ['main', 'agent/retarget-capability-planner', 'release/v1.0', 'Case.Mixed']) {
            input.effectiveBranches[branch] = rules.map(effectiveRule);
        }
        const raw = canonicalJson(input);
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
        expect(canonicalJson(plan.baseline ?? null)).toBe(raw);
        expect(plan.baselineDigest).toBe(createHash('sha256').update(raw).digest('hex'));
        expect(plan.originalMainRollback).toEqual([canonicalJson(requiredRuleset(input))]);
        expect(plan.captureEnvelopeDigest).toBe(
            createHash('sha256')
                .update(canonicalJson({ sourceSha: SOURCE, observedAt: INTERVAL, baseline: input }))
                .digest('hex')
        );
        expect(plan.activationEligible).toBe(false);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
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
        {
            url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
            required_status_checks: { contexts: ['Gate'] },
            enforce_admins: { enabled: false },
            required_pull_request_reviews: null,
            restrictions: null,
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

    it('accepts a structured exact-main protection response with present empty checks', () => {
        const input: CapabilityObservation = {
            ...observed(),
            exactMainProtection: {
                url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
                required_status_checks: { contexts: [], checks: [], enforcement_level: 'non_admins' },
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

    it.each([
        { label: 'empty contexts and checks', contexts: [], checks: [], complete: true },
        { label: 'required context with no binding', contexts: ['Gate'], checks: [], complete: false },
        {
            label: 'partially bound contexts',
            contexts: ['Gate', 'Build'],
            checks: [{ context: 'Gate', app_id: null }],
            complete: false,
        },
        {
            label: 'mismatched binding',
            contexts: ['Gate'],
            checks: [{ context: 'Build', app_id: 42 }],
            complete: false,
        },
        {
            label: 'every required context bound',
            contexts: ['Gate', 'Build'],
            checks: [
                { context: 'Build', app_id: 42 },
                { context: 'Gate', app_id: null },
            ],
            complete: true,
        },
        {
            label: 'duplicate valid bindings',
            contexts: ['Gate'],
            checks: [
                { context: 'Gate', app_id: null },
                { context: 'Gate', app_id: 42 },
            ],
            complete: true,
        },
    ])('records exact-main check coverage for $label', ({ contexts, checks, complete }) => {
        const exactMainProtection = {
            ...requiredRecord(observed().exactMainProtection ?? undefined),
            required_status_checks: { contexts, checks },
        };
        const plan = buildCapabilityPlan({ ...observed(), exactMainProtection }, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(complete);
        expect(plan.limitations).toEqual(complete ? [] : ['exact main classic protection is incomplete']);
        expect(plan.activationEligible).toBe(false);
        expect(requiredRecord(plan.baseline).exactMainProtection).toEqual(exactMainProtection);
        expect(plan.baselineDigest).toBe(
            createHash('sha256')
                .update(canonicalJson(plan.baseline ?? null))
                .digest('hex')
        );
        expect(plan.proposal).toEqual(CAPABILITY_PROPOSAL);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    const restrictionKinds = ['users', 'teams', 'apps'] as const;
    const malformedRestrictionActors: Array<{ label: string; actor: JsonValue }> = [
        { label: 'null', actor: null },
        { label: 'primitive', actor: 'actor' },
        { label: 'array', actor: [] },
        { label: 'missing id', actor: {} },
        { label: 'null id', actor: { id: null } },
        { label: 'string id', actor: { id: '42' } },
        { label: 'fractional id', actor: { id: 1.5 } },
        { label: 'zero id', actor: { id: 0 } },
        { label: 'negative id', actor: { id: -1 } },
        { label: 'unsafe integer id', actor: { id: Number.MAX_SAFE_INTEGER + 1 } },
    ];
    it.each(
        restrictionKinds.flatMap((kind) =>
            malformedRestrictionActors.map(({ label, actor }) => ({ kind, label, actor }))
        )
    )('marks $kind restriction actor with $label incomplete without dropping the raw capture', ({ kind, actor }) => {
        const exactMainProtection = {
            ...requiredRecord(observed().exactMainProtection ?? undefined),
            restrictions: { users: [], teams: [], apps: [], [kind]: [{ id: 42 }, actor] },
        };
        const input: CapabilityObservation = { ...observed(), exactMainProtection };
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('exact main classic protection is incomplete');
        expect(plan.activationEligible).toBe(false);
        expect(requiredRecord(plan.baseline).exactMainProtection).toEqual(exactMainProtection);
        expect(plan.baselineDigest).toBe(
            createHash('sha256')
                .update(canonicalJson(plan.baseline ?? null))
                .digest('hex')
        );
        expect(plan.proposal).toEqual(CAPABILITY_PROPOSAL);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it.each(restrictionKinds.flatMap((kind) => [1, Number.MAX_SAFE_INTEGER].map((id) => ({ kind, id }))))(
        'accepts $kind restriction actor with positive safe id $id',
        ({ kind, id }) => {
            const exactMainProtection = {
                ...requiredRecord(observed().exactMainProtection ?? undefined),
                restrictions: { users: [], teams: [], apps: [], [kind]: [{ id, name: 'actor' }] },
            };
            const plan = buildCapabilityPlan({ ...observed(), exactMainProtection }, SOURCE, INTERVAL);
            expect(plan.completeObservedInventory).toBe(true);
            expect(plan.limitations).toEqual([]);
            expect(plan.activationEligible).toBe(false);
            expect(requiredRecord(plan.baseline).exactMainProtection).toEqual(exactMainProtection);
            expect(plan.proposal).toEqual(CAPABILITY_PROPOSAL);
        }
    );

    it.each(
        [
            [{ context: 'Gate', app_id: { unreadable: true } }],
            [{ context: 'Gate', app_id: '42' }],
            [{ context: 'Gate' }],
            [{ app_id: 42 }],
            [null],
            { context: 'Gate', app_id: 42 },
            null,
        ].map((checks) => ({ checks }))
    )('marks malformed present exact-main check bindings incomplete', ({ checks }) => {
        const input: CapabilityObservation = {
            ...observed(),
            exactMainProtection: {
                url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
                required_status_checks: {
                    url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection/required_status_checks',
                    contexts_url:
                        'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection/required_status_checks/contexts',
                    strict: false,
                    contexts: ['Gate'],
                    checks,
                },
                enforce_admins: { enabled: false },
                required_pull_request_reviews: null,
                restrictions: null,
            },
        };
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(false);
        expect(plan.limitations).toContain('exact main classic protection is incomplete');
        expect(plan.activationEligible).toBe(false);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
    });

    it.each([42, null])('accepts exact-main check binding %s and preserves disabled proposal', (appId) => {
        const input: CapabilityObservation = {
            ...observed(),
            exactMainProtection: {
                url: 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection',
                required_status_checks: { contexts: ['Gate'], checks: [{ context: 'Gate', app_id: appId }] },
                enforce_admins: { enabled: false },
                required_pull_request_reviews: null,
                restrictions: null,
            },
        };
        const plan = buildCapabilityPlan(input, SOURCE, INTERVAL);
        expect(plan.completeObservedInventory).toBe(true);
        expect(plan.limitations).toEqual([]);
        expect(plan.activationEligible).toBe(false);
        expect(renderCapabilityPlan(plan)).toBe(canonicalJson(plan));
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

        const valid = observed();
        requiredRuleset(valid).rules = [
            {
                type: 'required_status_checks',
                parameters: {
                    strict_required_status_checks_policy: false,
                    required_status_checks: [{ context: 'Gate' }, { context: 'Gate', integration_id: 42 }],
                    do_not_enforce_on_create: false,
                },
            },
        ];
        valid.effectiveBranches.main = [];
        expect(buildCapabilityPlan(valid, SOURCE, INTERVAL).completeObservedInventory).toBe(true);
    });

    const malformedRequiredCheckParameters: JsonValue[] = [
        { required_status_checks: [] },
        { strict_required_status_checks_policy: 'false', required_status_checks: [] },
        { strict_required_status_checks_policy: false, required_status_checks: [{}] },
        { strict_required_status_checks_policy: false, required_status_checks: [null] },
        {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: 'Gate', integration_id: null }],
        },
        {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: 'Gate', integration_id: 1.5 }],
        },
        {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: 'Gate', integration_id: '42' }],
        },
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
