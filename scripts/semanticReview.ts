#!/usr/bin/env node
/**
 * `pnpm review:semantic` — the advisory semantic-review command.
 *
 * One shared entry point for the same implementation CI would use: `scan` assesses a change,
 * `verify` assesses candidate findings, `validate` checks a report, and `replay` reinterprets a saved
 * assessment offline. It never publishes a finding, never approves, never merges, and never edits
 * product code; its output is advice for the existing orchestrator.
 *
 * Trust boundary. The reviewed branch is read through Git objects as data. Nothing here checks out a
 * PR head, executes repository tooling, installs hooks, or runs source-controlled programs, and the
 * provider endpoint is pinned in code so no environment value or PR-controlled file can redirect it.
 *
 * Semantic sidecars are written outside the reviewer-visible review bundle on purpose: a blind
 * reviewer is handed that bundle, and these reports carry proposed verdicts and probabilities.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertTrustedExecutingBlob, originMainBlob, parseDotenv, resolvePrimaryRoot } from './githubAppIdentity.ts';
import {
    buildRevisionContext,
    refuse,
    SemanticFailure,
    SEMANTIC_POLICY_VERSION,
    SEMANTIC_SIDECAR_DIRECTORY,
    type SemanticFailureCode,
} from './semanticReview/contracts.ts';
import {
    createGitSourcePort,
    resolveFromBundle,
    resolveFromPullRequest,
    resolveFromRefs,
    type ResolvedRevision,
} from './semanticReview/gitSource.ts';
import { interpretScanOutcome } from './semanticReview/interpret.ts';
import { createFileCache, createSdkProviderPort, TYPESAFE_API_KEY_ENV } from './semanticReview/provider.ts';
import {
    parseReportJson,
    renderSummary,
    serializeReport,
    validateReport,
    type SemanticReport,
} from './semanticReview/report.ts';
import {
    assertBudgetProfile,
    computePolicyDigest,
    SEMANTIC_BUDGET_PROFILES,
    semanticRule,
    type RuleThresholds,
    type SemanticBudgetProfile,
    type SemanticProfileName,
    type SemanticRuleId,
} from './semanticReview/rules.ts';
import { assertQuestionsAreReplayable, runScan, type StoredUnitResponse } from './semanticReview/run.ts';
import { parseCandidateFindings, runVerify } from './semanticReview/verify.ts';

const EXIT_OK = 0;
const EXIT_INVALID = 2;
const EXIT_INCOMPLETE = 3;
const EXIT_STALE = 4;

const SUBCOMMANDS = ['scan', 'verify', 'validate', 'replay'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE = [
    'Usage: pnpm review:semantic <command> [options]',
    '',
    'Commands:',
    '  scan --pr <number>                          Assess a pull request change.',
    '  scan --bundle <path>                        Assess the change a review bundle records.',
    '  scan --base <ref> --head <ref>              Assess an explicit revision pair (needs --profile local).',
    '  verify --bundle <path> --findings <path>    Assess candidate findings before publication.',
    '  validate --report <path>                    Validate a stored report without any provider call.',
    '  replay --report <path> --policy <path>      Reinterpret a stored assessment offline.',
    '',
    'Options:',
    '  --dry-run                Resolve scope and build requests, but make zero TypeSafe calls.',
    '  --profile <ci|local>     Budget profile. Default ci; local is required for --base/--head.',
    '  --out <path>             Write the report here instead of the default sidecar.',
    '  --export-payload <path>  Write request bodies for local inspection. Contains source. Not for CI.',
    '  --trusted-sha <sha>      The executable revision this run is bound to. CI passes the commit it',
    '                           checked out; default origin/main, which is the local checked-out tree.',
    '',
    `Requires ${TYPESAFE_API_KEY_ENV} in the environment or in <primary-root>/.env.sourdaw-semantic.`,
    'Exit codes: 0 completed, 2 invalid invocation or report, 3 incomplete or unavailable, 4 stale revision.',
].join('\n');

type ParsedArgs = {
    command: Subcommand;
    pr?: number;
    bundlePath?: string;
    base?: string;
    head?: string;
    findingsPath?: string;
    reportPath?: string;
    policyPath?: string;
    outPath?: string;
    exportPayloadPath?: string;
    trustedSha?: string;
    profile: SemanticProfileName;
    dryRun: boolean;
};

/** A pull request number is a positive safe integer or the invocation is refused. */
function parsePrOption(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        refuse('unsupported_scope', '--pr must be a positive integer');
    }
    return parsed;
}

/** Only the two shipped budget profiles are selectable; an unknown name is refused. */
function parseProfileOption(value: string): SemanticProfileName {
    if (value === 'ci' || value === 'local') {
        return value;
    }
    return refuse('unsupported_scope', '--profile must be ci or local');
}

function parseCommandLine(argv: readonly string[]): ParsedArgs {
    const command = argv[0];
    if (command === undefined || !(SUBCOMMANDS as readonly string[]).includes(command)) {
        refuse('unsupported_scope', USAGE);
    }
    const parsed: ParsedArgs = { command: command as Subcommand, profile: 'ci', dryRun: false };
    let index = 1;
    const takeValue = (option: string): string => {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            refuse('unsupported_scope', `${option} requires a value\n\n${USAGE}`);
        }
        index += 1;
        return value;
    };
    for (; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === undefined) {
            break;
        }
        if (argument === '--dry-run') {
            parsed.dryRun = true;
            continue;
        }
        if (argument === '--help') {
            refuse('unsupported_scope', USAGE);
        }
        if (argument === '--pr') {
            parsed.pr = parsePrOption(takeValue('--pr'));
            continue;
        }
        if (argument === '--bundle') {
            parsed.bundlePath = takeValue('--bundle');
            continue;
        }
        if (argument === '--base') {
            parsed.base = takeValue('--base');
            continue;
        }
        if (argument === '--head') {
            parsed.head = takeValue('--head');
            continue;
        }
        if (argument === '--findings') {
            parsed.findingsPath = takeValue('--findings');
            continue;
        }
        if (argument === '--report') {
            parsed.reportPath = takeValue('--report');
            continue;
        }
        if (argument === '--policy') {
            parsed.policyPath = takeValue('--policy');
            continue;
        }
        if (argument === '--out') {
            parsed.outPath = takeValue('--out');
            continue;
        }
        if (argument === '--export-payload') {
            parsed.exportPayloadPath = takeValue('--export-payload');
            continue;
        }
        if (argument === '--trusted-sha') {
            parsed.trustedSha = takeValue('--trusted-sha');
            continue;
        }
        if (argument === '--profile') {
            parsed.profile = parseProfileOption(takeValue('--profile'));
            continue;
        }
        refuse('unsupported_scope', `unknown option ${argument}\n\n${USAGE}`);
    }
    return parsed;
}

/** `git diff` with external diff drivers, text conversion, and hooks disabled, in array-argument form. */
function loadApiKey(primaryRoot: string): string {
    const fromEnv = process.env[TYPESAFE_API_KEY_ENV];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
        return fromEnv.trim();
    }
    const path = join(primaryRoot, '.env.sourdaw-semantic');
    if (existsSync(path)) {
        const parsed = parseDotenv(readFileSync(path, 'utf8'));
        const value = parsed[TYPESAFE_API_KEY_ENV];
        if (value !== undefined && value.trim() !== '') {
            return value.trim();
        }
    }
    return refuse(
        'missing_credentials',
        `refusing to call TypeSafe: ${TYPESAFE_API_KEY_ENV} is not set in the environment or in ${path}`
    );
}

function sidecarDirectory(primaryRoot: string, contextDigest: string): string {
    return join(primaryRoot, '.agents', SEMANTIC_SIDECAR_DIRECTORY, contextDigest);
}

function writeSidecar(input: {
    readonly primaryRoot: string;
    readonly report: SemanticReport;
    readonly outPath: string | undefined;
    readonly summary: string;
}): string {
    const directory = sidecarDirectory(input.primaryRoot, input.report.context.contextDigest);
    const reportPath =
        input.outPath ?? join(directory, input.report.mode === 'scan' ? 'scan.json' : 'verification.json');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, serializeReport(input.report));
    const summaryPath = join(dirname(reportPath), 'summary.md');
    writeFileSync(summaryPath, `${input.summary}\n`);
    return reportPath;
}

/** The durable local response cache, beside the reports and outside the tracked tree. */
function responseCache(primaryRoot: string) {
    return createFileCache(join(primaryRoot, '.agents', SEMANTIC_SIDECAR_DIRECTORY, 'cache'));
}

function writeResponsesSidecar(
    reportPath: string,
    report: SemanticReport,
    responses: readonly StoredUnitResponse[]
): void {
    // Bound to the report's own identity: without it, a report could be replayed against another
    // run's answers and stamped with this run's revision.
    writeFileSync(
        join(dirname(reportPath), 'responses.json'),
        `${JSON.stringify(
            { contextDigest: report.context.contextDigest, rulesDigest: report.rulesDigest, units: responses },
            null,
            4
        )}\n`
    );
}

function profileFor(parsed: ParsedArgs): SemanticBudgetProfile {
    const profile = SEMANTIC_BUDGET_PROFILES[parsed.profile];
    assertBudgetProfile(profile);
    return profile;
}

function exitCodeForFailure(code: SemanticFailureCode): number {
    if (code === 'unsupported_scope' || code === 'invalid_response') {
        return EXIT_INVALID;
    }
    if (code === 'stale_context') {
        return EXIT_STALE;
    }
    return EXIT_INCOMPLETE;
}

async function handlerScan(parsed: ParsedArgs, primaryRoot: string): Promise<number> {
    if (parsed.bundlePath === undefined && parsed.pr === undefined) {
        if (parsed.base === undefined || parsed.head === undefined) {
            refuse('unsupported_scope', `scan needs --pr, --bundle, or both --base and --head\n\n${USAGE}`);
        }
        if (parsed.profile !== 'local') {
            refuse('unsupported_scope', 'an explicit --base/--head scan requires --profile local');
        }
    }
    const profile = profileFor(parsed);
    let resolved: ResolvedRevision;
    if (parsed.bundlePath !== undefined) {
        resolved = resolveFromBundle(primaryRoot, parsed.bundlePath, parsed.trustedSha);
    } else if (parsed.pr !== undefined) {
        resolved = resolveFromPullRequest(primaryRoot, parsed.pr, parsed.trustedSha);
    } else {
        resolved = resolveFromRefs(primaryRoot, parsed.base as string, parsed.head as string, parsed.trustedSha);
    }

    const cache = responseCache(primaryRoot);
    const controller = new AbortController();
    let provider = createSdkProviderPort({ apiKey: loadApiKey(primaryRoot) });
    if (parsed.dryRun) {
        provider = {
            systemOne: () => {
                refuse('unsupported_scope', 'dry-run made a provider call; this is a defect');
            },
        };
    }

    const result = await runScan({
        ports: {
            source: createGitSourcePort(primaryRoot),
            provider,
            cache,
            clock: { now: () => Date.now() },
            signal: controller.signal,
            log: (message) => console.log(message),
        },
        revision: resolved.revision,
        profile,
        // The per-region ceiling sits inside the per-request state budget; the run-wide ceiling is
        // the total submitted-byte budget, so one large file cannot starve every later unit.
        limits: {
            maxRegionBytes: profile.maxStatePlusQuestionBytes,
            maxTotalBytes: profile.maxTotalSubmittedBytes,
        },
        contractPaths: [],
        runId: `${String(resolved.revision.prNumber ?? 0)}-${resolved.headSha.slice(0, 12)}-${new Date().toISOString()}`,
        dryRun: parsed.dryRun,
    });

    const summary = renderSummary(result.report);
    console.log(summary);

    if (parsed.exportPayloadPath !== undefined) {
        console.warn(
            `WARNING: ${parsed.exportPayloadPath} will contain repository source and is for local inspection only. Do not upload it or commit it.`
        );
        if (parsed.dryRun) {
            writeFileSync(parsed.exportPayloadPath, `${JSON.stringify(result.previews, null, 4)}\n`);
        } else {
            refuse('unsupported_scope', '--export-payload is only supported together with --dry-run');
        }
    }
    if (parsed.dryRun) {
        console.log(`dry-run: ${String(result.previews.length)} request(s) would be sent; no TypeSafe call was made`);
        return EXIT_OK;
    }

    const validatedReport = validateReport(result.report);
    const reportPath = writeSidecar({
        primaryRoot,
        report: validatedReport,
        outPath: parsed.outPath,
        summary,
    });
    writeResponsesSidecar(reportPath, validatedReport, result.storedResponses);
    console.log(`report: ${reportPath}`);
    if (result.report.execution === 'unavailable' || result.report.execution === 'cancelled') {
        return EXIT_INCOMPLETE;
    }
    if (result.report.execution === 'partial') {
        return EXIT_INCOMPLETE;
    }
    return EXIT_OK;
}

async function handlerVerify(parsed: ParsedArgs, primaryRoot: string): Promise<number> {
    if (parsed.bundlePath === undefined || parsed.findingsPath === undefined) {
        refuse('unsupported_scope', `verify needs --bundle and --findings\n\n${USAGE}`);
    }
    const profile = profileFor(parsed);
    const resolved = resolveFromBundle(primaryRoot, parsed.bundlePath, parsed.trustedSha);
    const findings = parseCandidateFindings(
        JSON.parse(readFileSync(parsed.findingsPath, 'utf8')) as unknown,
        `candidate findings at ${parsed.findingsPath}`
    );
    const controller = new AbortController();
    const result = await runVerify({
        ports: {
            source: createGitSourcePort(primaryRoot),
            provider: createSdkProviderPort({ apiKey: loadApiKey(primaryRoot) }),
            cache: responseCache(primaryRoot),
            clock: { now: () => Date.now() },
            signal: controller.signal,
            log: (message) => console.log(message),
        },
        revision: resolved.revision,
        profile,
        limits: {
            maxRegionBytes: profile.maxStatePlusQuestionBytes,
            maxTotalBytes: profile.maxTotalSubmittedBytes,
        },
        findings,
        runId: `verify-${resolved.headSha.slice(0, 12)}-${new Date().toISOString()}`,
    });
    const summary = renderSummary(result.report);
    console.log(summary);
    const reportPath = writeSidecar({
        primaryRoot,
        report: validateReport(result.report),
        outPath: parsed.outPath,
        summary,
    });
    console.log(`report: ${reportPath}`);
    if (result.report.execution !== 'completed') {
        return EXIT_INCOMPLETE;
    }
    return EXIT_OK;
}

function handlerValidate(parsed: ParsedArgs, primaryRoot: string): number {
    if (parsed.reportPath === undefined) {
        refuse('unsupported_scope', `validate needs --report\n\n${USAGE}`);
    }
    const text = readFileSync(parsed.reportPath, 'utf8');
    const report = parseReportJson(text, `semantic report at ${parsed.reportPath}`);
    console.log(renderSummary(report));
    console.log(`valid: ${parsed.reportPath}`);
    void primaryRoot;
    // The exit code is the machine-readable completeness signal, so a stored assessment that scan
    // would call incomplete must not exit 0 here.
    return report.execution === 'completed' || report.execution === 'skipped' ? EXIT_OK : EXIT_INCOMPLETE;
}

/**
 * Replay applies a selected local policy to a saved assessment and makes no provider call. A
 * threshold change may reinterpret an existing response; a changed question, evidence slice,
 * contract, or model would require a new assessment and is not attempted here.
 */
function handlerReplay(parsed: ParsedArgs, primaryRoot: string): number {
    if (parsed.reportPath === undefined) {
        refuse('unsupported_scope', `replay needs --report\n\n${USAGE}`);
    }
    const report = parseReportJson(readFileSync(parsed.reportPath, 'utf8'), `semantic report at ${parsed.reportPath}`);
    if (report.mode !== 'scan') {
        refuse('unsupported_scope', 'replay currently reinterprets scan reports only');
    }
    // Replay may change thresholds, because a threshold does not change what the model was asked. It
    // may never change the question: thresholding an answer to one question as though it answered
    // another would present a disposition nothing produced.
    assertQuestionsAreReplayable(report);
    const sidecar = join(dirname(parsed.reportPath), 'responses.json');
    if (!existsSync(sidecar)) {
        refuse(
            'unsupported_scope',
            `replay needs the saved responses beside the report at ${sidecar}; the original run did not record them`
        );
    }
    const responses = parseStoredResponses(JSON.parse(readFileSync(sidecar, 'utf8')) as unknown, sidecar);
    if (responses.contextDigest !== report.context.contextDigest || responses.rulesDigest !== report.rulesDigest) {
        refuse(
            'stale_context',
            `the saved responses at ${sidecar} belong to a different assessment than ${parsed.reportPath}; replaying them would stamp another run's answers with this report's identity`
        );
    }
    const overrides =
        parsed.policyPath === undefined ? undefined : parsePolicyOverrides(parsed.policyPath, primaryRoot);

    const signals = responses.units.flatMap((unit) =>
        unit.ruleIds.map((ruleId) => {
            const rule = semanticRule(ruleId);
            const thresholds = overrides?.[ruleId];
            const effective = thresholds === undefined ? rule : { ...rule, thresholds };
            return interpretScanOutcome({
                answer: unit.answers[ruleId],
                rule: effective,
                unitId: unit.unitId,
                path: unit.path,
                missingEvidence: unit.missingEvidence[ruleId] ?? [],
            });
        })
    );

    const replayedVersion = `${SEMANTIC_POLICY_VERSION}+replay${parsed.policyPath === undefined ? '' : `:${basenameOf(parsed.policyPath)}`}`;
    // The context is rebuilt rather than copied: it embeds the policy version in its own digest, so a
    // replayed report whose context still names the stored policy would be internally inconsistent.
    const replayedContext = buildRevisionContext({
        repository: report.context.repository,
        repositoryId: report.context.repositoryId,
        prNumber: report.context.prNumber,
        headSha: report.context.headSha,
        targetBaseSha: report.context.targetBaseSha,
        mergeBaseSha: report.context.mergeBaseSha,
        trustedExecutionSha: report.context.trustedExecutionSha,
        contractSourceSha: report.context.contractSourceSha,
        evidenceProfile: report.context.evidenceProfile,
        rulesDigest: report.context.rulesDigest,
        policyVersion: replayedVersion,
    });
    const replayed = {
        ...report,
        context: replayedContext,
        signals,
        // The policy recorded is the one this replay actually applied, never the stored one.
        policyDigest: computePolicyDigest(overrides ?? {}),
        policyVersion: replayedVersion,
        execution: report.execution,
        usage: report.usage,
    };
    const validated = validateReport(replayed);
    const summary = renderSummary(validated);
    console.log(summary);
    const outPath = parsed.outPath ?? join(dirname(parsed.reportPath), 'replayed.json');
    writeFileSync(outPath, serializeReport(validated));
    console.log(`replayed: ${outPath} (no provider call was made)`);
    return validated.execution === 'completed' || validated.execution === 'skipped' ? EXIT_OK : EXIT_INCOMPLETE;
}

function basenameOf(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
}

type StoredResponses = {
    readonly contextDigest: string;
    readonly rulesDigest: string;
    readonly units: readonly {
        readonly unitId: string;
        readonly path: string;
        readonly ruleIds: readonly SemanticRuleId[];
        readonly answers: Readonly<Record<string, unknown>>;
        readonly missingEvidence: Readonly<Record<string, readonly string[]>>;
    }[];
};

function parseStoredResponses(value: unknown, label: string): StoredResponses {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const units = record.units;
    if (!Array.isArray(units)) {
        refuse('invalid_response', `${label} must carry a units array`);
    }
    if (typeof record.contextDigest !== 'string' || typeof record.rulesDigest !== 'string') {
        refuse('invalid_response', `${label} must record the identity of the assessment it belongs to`);
    }
    return {
        contextDigest: record.contextDigest,
        rulesDigest: record.rulesDigest,
        units: units.map((entry, index) => {
            const at = `${label}.units[${String(index)}]`;
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
                refuse('invalid_response', `${at} must be an object`);
            }
            const record = entry as Record<string, unknown>;
            if (typeof record.unitId !== 'string' || typeof record.path !== 'string') {
                refuse('invalid_response', `${at} needs unitId and path`);
            }
            if (!Array.isArray(record.ruleIds) || typeof record.answers !== 'object' || record.answers === null) {
                refuse('invalid_response', `${at} needs ruleIds and answers`);
            }
            return {
                unitId: record.unitId,
                path: record.path,
                ruleIds: record.ruleIds as SemanticRuleId[],
                answers: record.answers as Record<string, unknown>,
                missingEvidence: (record.missingEvidence ?? {}) as Record<string, readonly string[]>,
            };
        }),
    };
}

/** A local policy file may change interpretation thresholds; it can never change a question or model. */
function parsePolicyOverrides(path: string, primaryRoot: string): Partial<Record<SemanticRuleId, RuleThresholds>> {
    void primaryRoot;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        refuse('unsupported_scope', `policy file ${path} must be an object`);
    }
    const thresholds = (parsed as Record<string, unknown>).thresholds;
    if (thresholds === undefined) {
        return {};
    }
    if (typeof thresholds !== 'object' || thresholds === null || Array.isArray(thresholds)) {
        refuse('unsupported_scope', `policy file ${path} thresholds must be an object`);
    }
    const overrides: Partial<Record<SemanticRuleId, RuleThresholds>> = {};
    for (const [ruleId, value] of Object.entries(thresholds as Record<string, unknown>)) {
        semanticRule(ruleId as SemanticRuleId);
        if (typeof value !== 'object' || value === null) {
            refuse('unsupported_scope', `policy thresholds for ${ruleId} must be an object`);
        }
        const record = value as Record<string, unknown>;
        const read = (key: string): number => {
            const entry = record[key];
            if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1) {
                refuse('unsupported_scope', `policy threshold ${ruleId}.${key} must be a number in [0, 1]`);
            }
            return entry;
        };
        overrides[ruleId as SemanticRuleId] = { fire: read('fire') };
    }
    return overrides;
}

async function main(): Promise<number> {
    const executingFile = fileURLToPath(import.meta.url);
    const primaryRoot = resolvePrimaryRoot();
    try {
        const parsed = parseCommandLine(process.argv.slice(2));
        assertTrustedExecutingBlob(
            'scripts/semanticReview.ts',
            executingFile,
            originMainBlob('scripts/semanticReview.ts', primaryRoot)
        );
        if (parsed.command === 'validate') {
            return handlerValidate(parsed, primaryRoot);
        }
        if (parsed.command === 'replay') {
            return handlerReplay(parsed, primaryRoot);
        }
        if (parsed.command === 'verify') {
            return await handlerVerify(parsed, primaryRoot);
        }
        return await handlerScan(parsed, primaryRoot);
    } catch (error) {
        if (error instanceof SemanticFailure) {
            console.error(`review:semantic: ${error.code}: ${error.message}`);
            return exitCodeForFailure(error.code);
        }
        console.error(error instanceof Error ? error.message : String(error));
        return EXIT_INVALID;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}

export { parseCommandLine };
