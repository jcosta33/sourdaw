import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import { unsafeCredentialReason } from './evidenceSafety.ts';
import { ORCHESTRATOR_USER_NODE_ID } from './githubAppIdentity.ts';
import { captureRollback, type RulesetDocument } from './rulesetHardening.ts';

export const CAPABILITY_PROPOSAL_NAME = 'native-publication-nonmain';
const EXACT_MAIN_PROTECTION_URL = 'https://api.github.com/repos/jcosta33/sourdaw/branches/main/protection';
function capabilityProposal(): RulesetDocument {
    return {
        name: CAPABILITY_PROPOSAL_NAME,
        target: 'branch',
        enforcement: 'disabled',
        conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/main'] } },
        bypass_actors: [{ actor_id: 8978270, actor_type: 'User', bypass_mode: 'always' }],
        rules: [{ type: 'creation' }, { type: 'update', parameters: { update_allows_fetch_and_merge: false } }],
    };
}

export const CAPABILITY_PROPOSAL = capabilityProposal();

export type CapabilityObservation = {
    readonly user: RulesetDocument;
    readonly repository: RulesetDocument;
    readonly rulesets: RulesetDocument[];
    readonly classic: RulesetDocument[];
    readonly effectiveBranches: Record<string, JsonValue[]>;
    readonly exactMainProtection: JsonValue | null;
    readonly limitations: string[];
};

export function capabilityObservationRecord(observation: CapabilityObservation): RulesetDocument {
    return {
        user: observation.user,
        repository: observation.repository,
        rulesets: observation.rulesets,
        classic: observation.classic,
        effectiveBranches: observation.effectiveBranches,
        exactMainProtection: observation.exactMainProtection,
        limitations: observation.limitations,
    };
}

function record(value: JsonValue, label: string): RulesetDocument {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} is malformed`);
    }
    return value;
}

function safe(value: JsonValue): void {
    if (typeof value === 'string') {
        if (unsafeCredentialReason(value) !== undefined || value.length > 2_048 || /[\u2028\u2029]/u.test(value)) {
            throw new Error('policy contains an unsafe value');
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            safe(entry);
        }
        return;
    }
    if (value !== null && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
            safe(key);
            safe(entry);
        }
    }
}

function sha256(value: JsonValue): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const KNOWN_RULE_TYPES = new Set([
    'creation',
    'update',
    'deletion',
    'required_linear_history',
    'required_signatures',
    'pull_request',
    'required_status_checks',
    'non_fast_forward',
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
]);
const KNOWN_RULE_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
    creation: [],
    update: ['update_allows_fetch_and_merge'],
    deletion: [],
    pull_request: [
        'dismiss_stale_reviews_on_push',
        'require_code_owner_review',
        'require_last_push_approval',
        'required_approving_review_count',
        'required_review_thread_resolution',
        'allowed_merge_methods',
    ],
    required_status_checks: [
        'strict_required_status_checks_policy',
        'required_status_checks',
        'do_not_enforce_on_create',
    ],
};

function jsonArray(value: JsonValue | undefined): value is JsonValue[] {
    return Array.isArray(value);
}

function nullableRecord(value: JsonValue | undefined): value is RulesetDocument | null {
    return value === null || (typeof value === 'object' && !Array.isArray(value));
}

function exactMainProtectionComplete(value: JsonValue | null): boolean {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        return false;
    }
    const checks = value.required_status_checks;
    const admins = value.enforce_admins;
    const reviews = value.required_pull_request_reviews;
    const restrictions = value.restrictions;
    if (
        value.url !== EXACT_MAIN_PROTECTION_URL ||
        !nullableRecord(checks) ||
        !nullableRecord(admins) ||
        !nullableRecord(reviews) ||
        !nullableRecord(restrictions)
    ) {
        return false;
    }
    return (
        (checks === null ||
            (jsonArray(checks.contexts) && checks.contexts.every((context) => typeof context === 'string'))) &&
        (admins === null || typeof admins.enabled === 'boolean') &&
        (reviews === null || Number.isSafeInteger(reviews.required_approving_review_count)) &&
        (restrictions === null ||
            (jsonArray(restrictions.users) && jsonArray(restrictions.teams) && jsonArray(restrictions.apps)))
    );
}

function exactMainProtectionLimitations(value: JsonValue | null): string[] {
    if (exactMainProtectionComplete(value)) {
        return [];
    }
    return ['exact main classic protection is incomplete'];
}

function stringSelectors(value: JsonValue | undefined): value is string[] {
    return Array.isArray(value) && value.every((selector) => typeof selector === 'string');
}

function rulesetShapeComplete(ruleset: RulesetDocument): ruleset is RulesetDocument & {
    rules: JsonValue[];
    bypass_actors: JsonValue[];
} {
    return (
        Number.isSafeInteger(ruleset.id) &&
        typeof ruleset.name === 'string' &&
        typeof ruleset.target === 'string' &&
        ['branch', 'tag', 'push'].includes(ruleset.target) &&
        typeof ruleset.enforcement === 'string' &&
        ['active', 'disabled', 'evaluate'].includes(ruleset.enforcement) &&
        typeof ruleset.source === 'string' &&
        typeof ruleset.source_type === 'string' &&
        jsonArray(ruleset.rules) &&
        jsonArray(ruleset.bypass_actors)
    );
}

function ruleLimitations(rule: JsonValue): string[] {
    const details = record(rule, 'ruleset rule');
    const type = details.type;
    if (typeof type !== 'string' || !KNOWN_RULE_TYPES.has(type)) {
        return ['an applicable ruleset has unknown rule semantics'];
    }
    if (details.parameters === undefined) {
        if (type === 'required_status_checks') {
            return ['an applicable ruleset has incomplete required status checks'];
        }
        return [];
    }
    const parameters = record(details.parameters, 'ruleset rule parameters');
    const known = KNOWN_RULE_PARAMETERS[type];
    if (known === undefined || Object.keys(parameters).some((key) => !known.includes(key))) {
        return ['an applicable ruleset has unknown parameter semantics'];
    }
    if (type === 'required_status_checks') {
        const checks = parameters.required_status_checks;
        if (
            typeof parameters.strict_required_status_checks_policy !== 'boolean' ||
            (parameters.do_not_enforce_on_create !== undefined &&
                typeof parameters.do_not_enforce_on_create !== 'boolean') ||
            !jsonArray(checks) ||
            checks.some((check) => {
                if (check === null || Array.isArray(check) || typeof check !== 'object') {
                    return true;
                }
                return (
                    typeof check.context !== 'string' ||
                    check.context.length === 0 ||
                    (check.integration_id !== undefined && !Number.isSafeInteger(check.integration_id))
                );
            })
        ) {
            return ['an applicable ruleset has incomplete required status checks'];
        }
    }
    return [];
}

function effectivePolicyLimitations(effectiveBranches: CapabilityObservation['effectiveBranches']): string[] {
    const limitations: string[] = [];
    if (!jsonArray(effectiveBranches.main)) {
        limitations.push('effective main rules unavailable');
    }
    for (const rules of Object.values(effectiveBranches)) {
        if (!jsonArray(rules)) {
            throw new Error('effective policy rules are malformed');
        }
        for (const rule of rules) {
            limitations.push(...ruleLimitations(rule));
        }
    }
    return limitations;
}

function policyLimitations(observation: CapabilityObservation, mainApplicabilityUnresolved: boolean): string[] {
    const limitations = [
        ...observation.limitations,
        ...exactMainProtectionLimitations(observation.exactMainProtection),
    ];
    if (mainApplicabilityUnresolved) {
        limitations.push('main ruleset applicability is unresolved');
    }
    const permissions = observation.repository.permissions;
    if (permissions === undefined || record(permissions, 'repository permissions').admin !== true) {
        limitations.push('repository administration visibility unavailable');
    }
    for (const ruleset of observation.rulesets) {
        if (!rulesetShapeComplete(ruleset)) {
            limitations.push('ruleset detail or bypass visibility is incomplete');
            continue;
        }
        if (ruleset.target !== 'branch') {
            continue;
        }
        if (ruleset.source_type !== 'Repository' || ruleset.source !== 'jcosta33/sourdaw') {
            limitations.push('inherited bypass visibility is not proven');
        }
        const conditions = ruleset.conditions;
        const refs = conditions === undefined ? null : record(conditions, 'conditions').ref_name;
        if (refs === null || refs === undefined) {
            limitations.push('branch ruleset conditions are incomplete');
        } else {
            const refName = record(refs, 'ref conditions');
            if (
                !jsonArray(refName.include) ||
                !jsonArray(refName.exclude) ||
                [...refName.include, ...refName.exclude].some((pattern) => typeof pattern !== 'string')
            ) {
                limitations.push('branch ruleset conditions are incomplete');
            }
        }
        for (const bypass of ruleset.bypass_actors) {
            const actor = record(bypass, 'ruleset bypass actor');
            if (
                !Number.isSafeInteger(actor.actor_id) ||
                typeof actor.actor_type !== 'string' ||
                typeof actor.bypass_mode !== 'string'
            ) {
                limitations.push('ruleset bypass actor identity is incomplete');
            }
        }
        for (const rule of ruleset.rules) {
            limitations.push(...ruleLimitations(rule));
        }
    }
    limitations.push(...effectivePolicyLimitations(observation.effectiveBranches));
    return [...new Set(limitations)].sort();
}

function observationFromBaseline(value: JsonValue | undefined): CapabilityObservation {
    const baseline = record(value ?? null, 'plan baseline');
    const rulesets = baseline.rulesets;
    const classic = baseline.classic;
    const effective = record(baseline.effectiveBranches ?? null, 'effective branches');
    const limitations = baseline.limitations;
    const exactMainProtection = baseline.exactMainProtection;
    if (
        !jsonArray(rulesets) ||
        !jsonArray(classic) ||
        !stringSelectors(limitations) ||
        exactMainProtection === undefined
    ) {
        throw new Error('plan baseline is malformed');
    }
    const effectiveBranches: Record<string, JsonValue[]> = {};
    for (const [branch, rules] of Object.entries(effective)) {
        if (!jsonArray(rules)) {
            throw new Error('plan effective branches are malformed');
        }
        effectiveBranches[branch] = rules;
    }
    return {
        user: record(baseline.user ?? null, 'plan user'),
        repository: record(baseline.repository ?? null, 'plan repository'),
        rulesets: rulesets.map((rule) => record(rule, 'plan ruleset')),
        classic: classic.map((rule) => record(rule, 'plan classic rule')),
        effectiveBranches,
        exactMainProtection,
        limitations,
    };
}

function assertIdentity(observation: CapabilityObservation): void {
    const user = observation.user;
    const repository = observation.repository;
    const owner = record(repository.owner ?? null, 'repository owner');
    if (
        user.type !== 'User' ||
        user.id !== 8978270 ||
        user.node_id !== ORCHESTRATOR_USER_NODE_ID ||
        owner.type !== 'User' ||
        owner.id !== 8978270 ||
        owner.node_id !== ORCHESTRATOR_USER_NODE_ID ||
        owner.login !== 'jcosta33' ||
        repository.id !== 1183242917 ||
        repository.node_id !== 'R_kgDORobapQ' ||
        repository.full_name !== 'jcosta33/sourdaw' ||
        repository.default_branch !== 'main'
    ) {
        throw new Error('immutable user, repository, or default branch does not match');
    }
}

function assertUniqueRulesets(rulesets: readonly RulesetDocument[]): void {
    const ids = new Set<number>();
    const names = new Set<string>();
    for (const ruleset of rulesets) {
        if (typeof ruleset.id === 'number') {
            if (ids.has(ruleset.id)) {
                throw new Error('duplicate ruleset id');
            }
            ids.add(ruleset.id);
        }
        if (
            typeof ruleset.name !== 'string' ||
            typeof ruleset.source_type !== 'string' ||
            typeof ruleset.source !== 'string'
        ) {
            continue;
        }
        const key = `${ruleset.source_type}:${ruleset.source}:${ruleset.name}`;
        if (names.has(key)) {
            throw new Error('duplicate ruleset name');
        }
        names.add(key);
    }
}

function selectorMatchesMain(selector: string): boolean | null {
    if (selector === '~ALL' || selector === '~DEFAULT_BRANCH' || selector === 'refs/heads/main') {
        return true;
    }
    if (/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(selector)) {
        return false;
    }
    return null;
}

function mainRulesets(rulesets: readonly RulesetDocument[]): {
    rulesets: RulesetDocument[];
    unresolved: boolean;
} {
    const selected: RulesetDocument[] = [];
    let unresolved = false;
    for (const ruleset of rulesets) {
        if (ruleset.target !== 'branch') {
            continue;
        }
        const conditions = ruleset.conditions;
        const refs = conditions === undefined ? null : record(conditions, 'conditions').ref_name;
        const refName = refs === null || refs === undefined ? null : record(refs, 'ref conditions');
        const include = refName?.include;
        const exclude = refName?.exclude;
        if (!stringSelectors(include) || !stringSelectors(exclude)) {
            unresolved = true;
            selected.push(ruleset);
            continue;
        }
        const included = include.map(selectorMatchesMain);
        const excluded = exclude.map(selectorMatchesMain);
        if (included.includes(null) || excluded.includes(null)) {
            unresolved = true;
        }
        if ((included.includes(true) || included.includes(null)) && !excluded.includes(true)) {
            selected.push(ruleset);
        }
    }
    return { rulesets: selected, unresolved };
}

/** The only emitted proposal is a disabled document; this function never authorizes activation. */
export function buildCapabilityPlan(
    observation: CapabilityObservation,
    sourceSha: string,
    interval: { readonly startedAt: string; readonly endedAt: string }
): RulesetDocument {
    if (
        !/^[0-9a-f]{40}$/u.test(sourceSha) ||
        !Number.isFinite(Date.parse(interval.startedAt)) ||
        !Number.isFinite(Date.parse(interval.endedAt)) ||
        Date.parse(interval.startedAt) > Date.parse(interval.endedAt)
    ) {
        throw new Error('source or observation interval is malformed');
    }
    const captured = structuredClone(observation);
    assertIdentity(captured);
    if (captured.rulesets.some((ruleset) => ruleset.name === CAPABILITY_PROPOSAL_NAME)) {
        throw new Error('proposed ruleset name already exists');
    }
    assertUniqueRulesets(captured.rulesets);
    const baseline = capabilityObservationRecord(captured);
    safe(baseline);
    const mainSelection = mainRulesets(captured.rulesets);
    const limitations = policyLimitations(captured, mainSelection.unresolved);
    const mainPolicy: RulesetDocument = {
        rulesets: mainSelection.rulesets,
        classic: captured.classic,
        effective: captured.effectiveBranches.main ?? [],
        exactProtection: captured.exactMainProtection,
    };
    const rollback = mainSelection.rulesets.map((ruleset) => captureRollback(ruleset));
    const proposal = capabilityProposal();
    const observedAt = { startedAt: interval.startedAt, endedAt: interval.endedAt };
    const plan: RulesetDocument = {
        format: 'retarget-capability-plan-v1',
        sourceSha,
        observedAt,
        baseline,
        baselineDigest: sha256(baseline),
        captureEnvelopeDigest: sha256({ sourceSha, observedAt, baseline }),
        originalMainSemanticDigest: sha256(mainPolicy),
        originalMainRollback: rollback,
        proposal,
        proposalDigest: sha256(proposal),
        futureActorOperationIntent: {
            operatorUser: {
                actorId: 8978270,
                actorType: 'User',
                branchCreate: 'bypass-always',
                branchUpdate: 'bypass-always',
            },
            authorApp: { branchCreate: 'restricted', branchUpdate: 'restricted' },
            otherActors: { branchCreate: 'restricted', branchUpdate: 'restricted' },
            observedEnforcement: false,
        },
        datedGrantEvidence: {
            artifact: 'retarget-installed-grants.json',
            observedAt: '2026-10-08T03:35:18.871Z',
            sha256: '29e1a118406a4c63f04a267b8eb541b481bbfde4e9e4660339870b017bd064f0',
            currentGrantClaim: false,
        },
        completeObservedInventory: limitations.length === 0,
        limitations,
        activationEligible: false,
        pending: [
            'security-role-decision',
            'fresh-installed-grants',
            'hosted-canary',
            'production-pattern-enforcement',
        ],
        claims: { atomicServerSnapshot: false, repairedDestinationBoundary: false, operatorGrantPresent: false },
    };
    safe(plan);
    return plan;
}

export function renderCapabilityPlan(plan: RulesetDocument): string {
    const expectedProposal = capabilityProposal();
    if (
        plan.activationEligible !== false ||
        canonicalJson(plan.proposal ?? null) !== canonicalJson(expectedProposal) ||
        plan.proposalDigest !== sha256(expectedProposal)
    ) {
        throw new Error('inactive proposal contract changed');
    }
    safe(plan);
    const interval = record(plan.observedAt ?? null, 'plan observation interval');
    if (
        typeof plan.sourceSha !== 'string' ||
        typeof interval.startedAt !== 'string' ||
        typeof interval.endedAt !== 'string'
    ) {
        throw new TypeError('plan evidence changed after capture');
    }
    const expected = buildCapabilityPlan(observationFromBaseline(plan.baseline), plan.sourceSha, {
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
    });
    if (canonicalJson(plan) !== canonicalJson(expected)) {
        throw new Error('plan evidence changed after capture');
    }
    return canonicalJson(plan);
}
