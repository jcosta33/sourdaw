#!/usr/bin/env node
/**
 * Canonicalise and harden the live `main` branch ruleset, inside one approved triple (#3002, #4584).
 *
 * The ruleset is repository configuration: it decides which status contexts are required and how a
 * pull request may merge. This command therefore treats it as a security boundary rather than as an
 * editable document. It names exactly the three approved head-discipline fields — stale-review
 * dismissal, last-push approval, and the approving-review count — and walks the decoded JSON to
 * refuse any difference outside that set, so a bug in the copy, a widened allowlist, or a server
 * that answers with something else cannot smuggle a change through underneath the set. In
 * particular a status context becoming required is a distinct refusal that names the added context,
 * because a required shadow status would turn the reviewer's non-authoritative shadow into merge
 * authority (AC-018).
 *
 * The approving-review count targets 1 for the single-approval review policy: the reviewer App's
 * approval of the current head is the one independent approval GitHub requires before merge.
 *
 * The write happens only through the verified orchestrator User, only after the rollback bytes are
 * captured, and only after every guard passes. When every approved field already holds, nothing is
 * written and the receipt says so. Reading back and holding the result to the guards is what proves
 * the write landed as planned rather than merely that a request was sent.
 */

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import {
    ORCHESTRATOR_USER_NODE_ID,
    assertRequiredRepository,
    authenticateOrchestratorSession,
    isOrchestratorUserNodeId,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
    type OrchestratorAuthentication,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export const RULESET_HARDENING_USAGE = 'usage: pnpm ruleset:harden [--apply]';

/**
 * The approved target set, and nothing else. A ruleset change touching any other path — including
 * any `required_status_checks` entry — is refused by name, so widening this list is the one edit
 * that would open the boundary. `required_approving_review_count` targets 1 for the single-approval
 * review policy: the reviewer App's approval of the current head is the one independent approval
 * GitHub requires before merge.
 */
export const HARDENING_TARGETS = [
    { field: 'dismiss_stale_reviews_on_push', to: true },
    { field: 'require_last_push_approval', to: true },
    { field: 'required_approving_review_count', to: 1 },
] as const;

export type HardeningTarget = (typeof HARDENING_TARGETS)[number];
export type HardeningField = HardeningTarget['field'];

/** A decoded ruleset (or any nested object) as GitHub returns it: plain JSON, never a class. */
export type RulesetDocument = { [key: string]: JsonValue };

export const MAIN_BRANCH_RULESET_NAME = 'main';
export const MAIN_BRANCH_RULESET_TARGET = 'branch';
export const REPOSITORY_RULESET_SOURCE_TYPE = 'Repository';

/** The writable keys the rulesets update endpoint accepts; every other key is read-only metadata. */
const WRITABLE_RULESET_KEYS = ['name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules'] as const;

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function describePath(path: string | undefined): string {
    return path === undefined || path === '' ? '<ruleset root>' : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: JsonValue | undefined): value is RulesetDocument {
    return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function asRulesetObject(value: JsonValue | undefined, label: string): RulesetDocument {
    if (!isJsonObject(value)) {
        fail(`${label} is not a readable JSON object`);
    }
    return value;
}

function readRules(ruleset: RulesetDocument): readonly JsonValue[] {
    const rules = ruleset.rules;
    if (!Array.isArray(rules)) {
        fail('ruleset has no readable rules array');
    }
    return rules;
}

export type PullRequestRule = { index: number; rule: RulesetDocument };

/**
 * The single `pull_request` rule. Two of them would make "the approved parameters" ambiguous, and
 * zero would leave nothing to harden, so both are refusals rather than a guess.
 */
export function findPullRequestRule(ruleset: RulesetDocument): PullRequestRule {
    const matches: PullRequestRule[] = [];
    for (const [index, entry] of readRules(ruleset).entries()) {
        if (isJsonObject(entry) && entry.type === 'pull_request') {
            matches.push({ index, rule: entry });
        }
    }
    const [match] = matches;
    if (match === undefined) {
        fail('ruleset has no pull_request rule to harden');
    }
    if (matches.length > 1) {
        fail(`ruleset has ${String(matches.length)} pull_request rules; hardening needs exactly one`);
    }
    return match;
}

export function pullRequestParameters(rule: RulesetDocument, index: number): RulesetDocument {
    return asRulesetObject(rule.parameters, `rules[${String(index)}] pull_request parameters`);
}

export type HardeningFieldPlan = {
    field: HardeningField;
    path: string;
    satisfied: boolean;
    from: JsonValue | undefined;
    to: HardeningTarget['to'];
};

export type HardeningPlan = {
    ruleIndex: number;
    satisfied: boolean;
    changes: HardeningFieldPlan[];
};

/** What the approved controls are and what would change. Pure: it reads and returns only. */
export function planHardening(ruleset: RulesetDocument): HardeningPlan {
    const { index, rule } = findPullRequestRule(ruleset);
    const parameters = pullRequestParameters(rule, index);
    const changes = HARDENING_TARGETS.map((target) => {
        const from = parameters[target.field];
        return {
            field: target.field,
            path: `rules[${String(index)}].parameters.${target.field}`,
            satisfied: from === target.to,
            from,
            to: target.to,
        };
    });
    return { ruleIndex: index, satisfied: changes.every((change) => change.satisfied), changes };
}

function cloneJsonValue(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
        return value.map((entry) => cloneJsonValue(entry));
    }
    if (isJsonObject(value)) {
        return cloneRuleset(value);
    }
    return value;
}

function cloneRuleset(ruleset: RulesetDocument): RulesetDocument {
    const clone: RulesetDocument = {};
    for (const [key, value] of Object.entries(ruleset)) {
        clone[key] = cloneJsonValue(value);
    }
    return clone;
}

/** The approved fields set to their targets, as a fresh object so no caller shares it. */
function approvedTargetsApplied(): RulesetDocument {
    const applied: RulesetDocument = {};
    for (const target of HARDENING_TARGETS) {
        applied[target.field] = target.to;
    }
    return applied;
}

/**
 * A deep copy with every approved field at its target and nothing else altered: same rule order,
 * same other parameters, same conditions, same bypass actors. The input is never mutated.
 */
export function buildHardenedRuleset(ruleset: RulesetDocument): RulesetDocument {
    const { index } = findPullRequestRule(ruleset);
    const cloned = cloneRuleset(ruleset);
    const rules = readRules(cloned).map((entry, entryIndex) => {
        if (entryIndex !== index) {
            return entry;
        }
        const rule = asRulesetObject(entry, `rules[${String(entryIndex)}]`);
        const parameters = pullRequestParameters(rule, entryIndex);
        return { ...rule, parameters: { ...parameters, ...approvedTargetsApplied() } };
    });
    return { ...cloned, rules };
}

/**
 * Every differing leaf path between two decoded structures, in a deterministic order. Arrays are
 * walked by index (so an extra or missing element names that index) and objects by sorted key (so a
 * missing key names that key). Comparing walked paths rather than serialized strings is what lets a
 * refusal name the exact JSON path, and it never conflates a reordered rule with an unchanged one.
 */
function collectDifferences(
    before: JsonValue | undefined,
    after: JsonValue | undefined,
    path: string,
    out: string[]
): void {
    if (Array.isArray(before) || Array.isArray(after)) {
        if (!Array.isArray(before) || !Array.isArray(after)) {
            out.push(path);
            return;
        }
        const length = Math.max(before.length, after.length);
        for (let index = 0; index < length; index += 1) {
            collectDifferences(before[index], after[index], `${path}[${String(index)}]`, out);
        }
        return;
    }
    if (isJsonObject(before) || isJsonObject(after)) {
        if (!isJsonObject(before) || !isJsonObject(after)) {
            out.push(path);
            return;
        }
        const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
        for (const key of keys) {
            collectDifferences(before[key], after[key], path === '' ? key : `${path}.${key}`, out);
        }
        return;
    }
    if (before !== after) {
        out.push(path);
    }
}

/** Every difference, not just the first: one approved field changing must not hide an illegal one. */
export function rulesetDifferences(before: RulesetDocument, after: RulesetDocument): string[] {
    const differences: string[] = [];
    collectDifferences(before, after, '', differences);
    return differences;
}

/**
 * Refuses any before/after pair differing anywhere outside the approved paths of the `before`
 * ruleset's `pull_request` rule, naming the first disallowed JSON path. Every difference is filtered
 * rather than the first returned, because a pair that changes an approved field *and* something else
 * would otherwise pass on the approved difference alone.
 */
export function assertOnlyApprovedFieldsChanged(before: RulesetDocument, after: RulesetDocument): void {
    const { index } = findPullRequestRule(before);
    const approved = new Set<string>(
        HARDENING_TARGETS.map((target) => `rules[${String(index)}].parameters.${target.field}`)
    );
    const disallowed = rulesetDifferences(before, after).filter((path) => !approved.has(path));
    if (disallowed.length > 0) {
        fail(
            `refusing ruleset change outside the approved set ${HARDENING_TARGETS.map((target) => target.field).join(', ')}: ` +
                `${String(disallowed.length)} disallowed difference(s), first at ${describePath(disallowed[0])}`
        );
    }
}

/**
 * Refuses a ruleset that leaves any approved field short of its target, naming that field's path.
 * The path-based guard above cannot see a wrong value on an approved path — a candidate that sets
 * the review count to 2 passes `assertOnlyApprovedFieldsChanged` because the path is approved — so
 * this is the value check that turns it into a refusal before any write, and the readback check
 * that proves the server stored every target.
 */
export function assertTargetsSatisfied(ruleset: RulesetDocument): void {
    const firstUnsatisfied = planHardening(ruleset).changes.find((change) => !change.satisfied);
    if (firstUnsatisfied === undefined) {
        return;
    }
    fail(
        `refusing ruleset change that leaves ${firstUnsatisfied.field} at ${describeValue(firstUnsatisfied.from)} ` +
            `instead of ${describeValue(firstUnsatisfied.to)} (${firstUnsatisfied.path})`
    );
}

/**
 * The union of every `required_status_checks` context the ruleset applies. A malformed rule refuses
 * rather than reading as an empty requirement, because an unreadable context list has not said that
 * nothing is required.
 */
export function requiredStatusContexts(ruleset: RulesetDocument): string[] {
    const contexts: string[] = [];
    for (const [index, entry] of readRules(ruleset).entries()) {
        if (!isJsonObject(entry) || entry.type !== 'required_status_checks') {
            continue;
        }
        const parameters = asRulesetObject(
            entry.parameters,
            `rules[${String(index)}] required_status_checks parameters`
        );
        const checks = parameters.required_status_checks;
        if (!Array.isArray(checks)) {
            fail(`rules[${String(index)}] required_status_checks rule carries no readable check list`);
        }
        for (const [checkIndex, check] of checks.entries()) {
            const label = `rules[${String(index)}].parameters.required_status_checks[${String(checkIndex)}]`;
            const record = asRulesetObject(check, label);
            if (typeof record.context !== 'string') {
                fail(`${label} has no readable context`);
            }
            contexts.push(record.context);
        }
    }
    return contexts;
}

/**
 * Refuses a pair in which the ruleset gains a required status context, naming every added context.
 * This is the AC-018 boundary: the shadow context `sourdaw/reviewer-shadow` is refused exactly as
 * firmly as a CI context, because the name is not consulted at all.
 */
export function assertNoRequiredContextAdded(before: RulesetDocument, after: RulesetDocument): void {
    const present = new Set(requiredStatusContexts(before));
    const added = Array.from(new Set(requiredStatusContexts(after))).filter((context) => !present.has(context));
    if (added.length > 0) {
        fail(`refusing ruleset change that requires status context(s): ${added.join(', ')}`);
    }
}

/**
 * The live ruleset's canonical bytes as they were before mutation, through the one shared
 * canonicaliser so a rollback has exactly one representation. Captured before any write is
 * attempted, so a failed or partial write always has its restore bytes in the receipt.
 */
export function captureRollback(ruleset: RulesetDocument): string {
    return canonicalJson(ruleset);
}

/** The keys the rulesets update endpoint accepts; metadata the server owns is not sent back. */
export function writableRuleset(ruleset: RulesetDocument): RulesetDocument {
    const projection: RulesetDocument = {};
    for (const key of WRITABLE_RULESET_KEYS) {
        const value = ruleset[key];
        if (value !== undefined) {
            projection[key] = value;
        }
    }
    if (typeof projection.name !== 'string') {
        fail('refusing to write a ruleset with no name');
    }
    return projection;
}

export function renderHardeningPlan(plan: HardeningPlan): string[] {
    return plan.changes.map(
        (change) => `ruleset-hardening-plan:${change.path}:${describeValue(change.from)}->${describeValue(change.to)}`
    );
}

export type RulesetHardeningOutcome = 'already-satisfied' | 'dry-run' | 'applied';

export type RulesetHardeningReceipt = {
    rulesetId: number;
    outcome: RulesetHardeningOutcome;
    changed: HardeningField[];
    rollback: string;
};

export function renderHardeningReceipt(receipt: RulesetHardeningReceipt): string {
    const changed = receipt.changed.length === 0 ? 'none' : receipt.changed.join(',');
    return `ruleset-hardening:${String(receipt.rulesetId)}:${receipt.outcome}:${changed}`;
}

export type RulesetHardeningPort = {
    /** The live id of the repository's `main` branch ruleset, resolved by name, never hardcoded. */
    resolveRulesetId(): number;
    readRuleset(rulesetId: number): RulesetDocument;
    writeRuleset(rulesetId: number, ruleset: RulesetDocument): void;
    log(message: string): void;
};

export type HardenedRulesetBuilder = (ruleset: RulesetDocument) => RulesetDocument;

/**
 * The whole operation against a port. Reading, planning and the rollback capture come first; every
 * guard then runs against the candidate write, so a candidate touching anything outside the
 * approved set, adding a required context, or leaving a field short of its target is refused before
 * the port is asked to write. With `apply` false the plan is reported and nothing is written. On
 * apply, the write is followed by a fresh read and the same guards over the writable projection,
 * which is what proves the server stored the plan.
 */
export function hardenRuleset(
    apply: boolean,
    port: RulesetHardeningPort,
    build: HardenedRulesetBuilder = buildHardenedRuleset
): RulesetHardeningReceipt {
    const rulesetId = port.resolveRulesetId();
    const live = port.readRuleset(rulesetId);
    const plan = planHardening(live);
    const rollback = captureRollback(live);
    if (plan.satisfied) {
        const receipt: RulesetHardeningReceipt = {
            rulesetId,
            outcome: 'already-satisfied',
            changed: [],
            rollback,
        };
        port.log(renderHardeningReceipt(receipt));
        return receipt;
    }
    const candidate = build(live);
    // The more specific AC-018 refusal runs first, so a candidate that adds a context is named as
    // that rather than as a generic difference somewhere in the rules.
    assertNoRequiredContextAdded(live, candidate);
    assertOnlyApprovedFieldsChanged(live, candidate);
    assertTargetsSatisfied(candidate);
    const changed = plan.changes.filter((change) => !change.satisfied).map((change) => change.field);
    if (!apply) {
        for (const line of renderHardeningPlan(plan)) {
            port.log(line);
        }
        const receipt: RulesetHardeningReceipt = { rulesetId, outcome: 'dry-run', changed, rollback };
        port.log(renderHardeningReceipt(receipt));
        return receipt;
    }
    port.log(`ruleset-rollback:${String(rulesetId)}:${rollback}`);
    port.writeRuleset(rulesetId, candidate);
    const readback = port.readRuleset(rulesetId);
    assertNoRequiredContextAdded(live, readback);
    assertOnlyApprovedFieldsChanged(writableRuleset(live), writableRuleset(readback));
    assertTargetsSatisfied(readback);
    const receipt: RulesetHardeningReceipt = { rulesetId, outcome: 'applied', changed, rollback };
    port.log(renderHardeningReceipt(receipt));
    return receipt;
}

type Gh = (args: string[], input?: string) => string;

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function readRulesetDocument(value: string, label: string): RulesetDocument {
    const parsed = parseJson<JsonValue>(value, label);
    if (!isJsonObject(parsed)) {
        fail(`${label} is not a readable ruleset object`);
    }
    return parsed;
}

function repositoryFields(gh: Gh): string {
    const nameWithOwner = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const [owner, name] = nameWithOwner.split('/');
    if (owner === undefined || name === undefined || owner === '' || name === '') {
        fail(`repository name ${nameWithOwner} is not owner/name`);
    }
    return `${owner}/${name}`;
}

/**
 * The id of the repository's own `main` branch ruleset. An inherited organisation ruleset with the
 * same name is a different object this command must not edit, so `source_type` is part of the match.
 */
export function readMainRulesetId(repository: string, gh: Gh): number {
    const label = `rulesets for ${repository}`;
    const listed = parseJson<unknown>(gh(['api', `repos/${repository}/rulesets?per_page=100`]), label);
    if (!isUnknownArray(listed)) {
        fail(`${label} is not a readable ruleset list`);
    }
    const matches = listed.filter(
        (entry): entry is Record<string, unknown> =>
            isRecord(entry) &&
            entry.name === MAIN_BRANCH_RULESET_NAME &&
            entry.target === MAIN_BRANCH_RULESET_TARGET &&
            entry.source_type === REPOSITORY_RULESET_SOURCE_TYPE
    );
    const [match] = matches;
    if (match === undefined) {
        fail(`${label} carries no repository ${MAIN_BRANCH_RULESET_NAME} ${MAIN_BRANCH_RULESET_TARGET} ruleset`);
    }
    if (matches.length > 1) {
        fail(`${label} carries ${String(matches.length)} matching ${MAIN_BRANCH_RULESET_NAME} rulesets`);
    }
    const id = match.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
        fail(`${label} returned an unreadable ruleset id ${describeValue(id)}`);
    }
    return id;
}

export function readRulesetById(repository: string, rulesetId: number, gh: Gh): RulesetDocument {
    const label = `ruleset ${String(rulesetId)} for ${repository}`;
    const ruleset = readRulesetDocument(gh(['api', `repos/${repository}/rulesets/${String(rulesetId)}`]), label);
    if (ruleset.id !== rulesetId) {
        fail(`${label} returned ruleset id ${describeValue(ruleset.id)}`);
    }
    return ruleset;
}

/**
 * The update write. Only writable keys are sent — the read carries server-owned metadata that the
 * endpoint does not accept — and the response is checked to be the same ruleset before the caller
 * reads it back. The body rides stdin so no shell quoting stands between the plan and the wire.
 */
export function writeRulesetById(repository: string, rulesetId: number, ruleset: RulesetDocument, gh: Gh): void {
    const label = `write ruleset ${String(rulesetId)} for ${repository}`;
    const body = JSON.stringify(writableRuleset(ruleset));
    const written = readRulesetDocument(
        gh(['api', '--method', 'PUT', `repos/${repository}/rulesets/${String(rulesetId)}`, '--input', '-'], body),
        label
    );
    if (written.id !== rulesetId) {
        fail(`${label} did not record ruleset ${String(rulesetId)}`);
    }
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): RulesetHardeningPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh: Gh = (args, input) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    const repository = repositoryFields(gh);
    return {
        resolveRulesetId: () => readMainRulesetId(repository, gh),
        readRuleset: (rulesetId) => readRulesetById(repository, rulesetId, gh),
        writeRuleset: (rulesetId, ruleset) => writeRulesetById(repository, rulesetId, ruleset, gh),
        log: (message) => {
            console.log(message);
        },
    };
}

export type RulesetHardeningCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateOrchestrator: () => OrchestratorAuthentication;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    port: (session: GhSession, primaryRoot: string) => RulesetHardeningPort;
    harden: (apply: boolean, port: RulesetHardeningPort) => RulesetHardeningReceipt;
};

export function defaultRulesetHardeningCoordinatorDependencies(): RulesetHardeningCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateOrchestrator: () => authenticateOrchestratorSession(),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        port: (session, primaryRoot) => shellPort(session, primaryRoot, spawnCapture),
        harden: (apply, port) => hardenRuleset(apply, port),
    };
}

/**
 * The identity boundary. `authenticateOrchestratorSession` already admits only the immutable
 * orchestrator actor; the node-id check here is the caller's own, so a substituted authentication
 * dependency is refused before the repository or the port is ever reached, and therefore before any
 * write. The repository assertion keeps the command on the one repository it is written for.
 */
export function coordinateRulesetHardening(
    apply: boolean,
    dependencies: RulesetHardeningCoordinatorDependencies = defaultRulesetHardeningCoordinatorDependencies()
): RulesetHardeningReceipt {
    const primaryRoot = dependencies.primaryRoot();
    const auth = dependencies.authenticateOrchestrator();
    try {
        if (!isOrchestratorUserNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${ORCHESTRATOR_USER_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        return dependencies.harden(apply, dependencies.port(auth.session, primaryRoot));
    } finally {
        auth.session.dispose();
    }
}

export type RulesetHardeningArgs = { apply: boolean; help: boolean };

export function parseRulesetHardeningArgs(args: string[]): RulesetHardeningArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { apply: false, help: true };
    }
    if (args.length === 0) {
        return { apply: false, help: false };
    }
    if (args.length === 1 && args[0] === '--apply') {
        return { apply: true, help: false };
    }
    return fail(RULESET_HARDENING_USAGE);
}

export async function runRulesetHardeningCli(
    args: string[],
    dependencies?: RulesetHardeningCoordinatorDependencies
): Promise<number> {
    const parsed = parseRulesetHardeningArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${RULESET_HARDENING_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    coordinateRulesetHardening(parsed.apply, dependencies);
    return 0;
}
