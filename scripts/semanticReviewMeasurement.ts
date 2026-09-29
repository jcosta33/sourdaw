#!/usr/bin/env node
/**
 * `pnpm review:semantic:measure` — what the advisory semantic review cost and what it returned.
 *
 * The audit of the semantic review found no measured defect yield behind its maintenance cost, and
 * recommended measuring before optimizing. This is that measurement: it reads the artifacts the
 * pipeline already writes — the stored scan and verification sidecars, the review dossiers, and the
 * evaluation runner's outcome file when one is given — and emits one record of rule coverage,
 * evidence completeness, outcome accounting, usage and wall clock, and the signal outcomes the review
 * rounds recorded. It changes nothing the scan does and calls no provider.
 *
 * Two readings it refuses to make. A returned probability is a model answer, not an accuracy figure,
 * and a question no request asked is not a correct negative: this record counts it as not asked and
 * says which rule and which missing evidence left it unasked. And a figure no artifact carries is
 * reported as not computable rather than as a zero, so an absent dossier never reads as a round that
 * found nothing.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { machineProvenance, writeRecord } from './desktopLatencyRecord.ts';
import { resolvePrimaryRoot } from './githubAppIdentity.ts';
import { parseReviewDossier, type ReviewDossier } from './reviewDossier.ts';
import { SEMANTIC_SIDECAR_DIRECTORY } from './semanticReview/contracts.ts';
import { parseReportJson, type SemanticReport, type SemanticUsageReport } from './semanticReview/report.ts';
import {
    addFixtureExtras,
    addReportExtras,
    aggregateEvaluationFixture,
    aggregateStoredReport,
    emptyRecordExtras,
} from './semanticReviewMeasurement/artifacts.ts';
import {
    type EvaluationFixtureOutcome,
    type AcrossRuns,
    type MeasurementDetail,
    type MeasurementMachine,
    type MeasurementRecord,
    type MeasurementRun,
    type MeasurementSources,
    type RecordExtras,
    type SemanticScopeStates,
    type SkippedArtifact,
    type StoredDossier,
} from './semanticReviewMeasurement/contracts.ts';
import { buildMeasurementRecord } from './semanticReviewMeasurement/record.ts';

const EXIT_OK = 0;
const EXIT_INVALID = 2;
const EXIT_NOTHING_TO_MEASURE = 3;

const USAGE = [
    'Usage: pnpm review:semantic:measure [options]',
    '',
    'Reads the stored semantic-review sidecars, review dossiers, and evaluation outcome file, and',
    'emits one measurement record. It makes no provider call and changes nothing.',
    '',
    'Options:',
    '  --root <path>        Checkout whose .agents/semantic-review/ and .agents/review-bundles/ are read.',
    '                       Default: the primary checkout, where the pipeline writes them.',
    '  --evaluation <path>  Also read the evaluation runner outcome file at this path.',
    '  --out <path>         Write the record here instead of printing it.',
    '  --detail             Publish one entry per run as well as the across-run figures. The default',
    '                       record is aggregate-level: the committed example is one, and a per-run',
    '                       record is far larger than the per-region evidence budget.',
    '  --summary            Print the human summary instead of the record.',
    '  --strict             Refuse on the first artifact that does not read, instead of recording it',
    '                       as skipped with its reason.',
    '',
    'Exit codes: 0 measured, 2 invalid invocation or input, 3 no artifact to measure.',
].join('\n');

type ParsedArgs = {
    readonly root?: string;
    readonly evaluationPath?: string;
    readonly outPath?: string;
    readonly detail: MeasurementDetail;
    readonly summary: boolean;
    readonly strict: boolean;
};

/** A refusal this command owns: the input is wrong, or there is nothing behind the request. */
class MeasurementFailure extends Error {
    readonly code: 'invalid_input' | 'nothing_to_measure';

    constructor(code: 'invalid_input' | 'nothing_to_measure', message: string) {
        super(message);
        this.name = 'MeasurementFailure';
        this.code = code;
    }
}

function invalid(message: string): never {
    throw new MeasurementFailure('invalid_input', message);
}

function parseCommandLine(argv: readonly string[]): ParsedArgs {
    let root: string | undefined;
    let evaluationPath: string | undefined;
    let outPath: string | undefined;
    let detail: MeasurementDetail = 'aggregate';
    let summary = false;
    let strict = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = (): string => {
            const next = argv[index + 1];
            if (next === undefined || next.startsWith('--')) {
                return invalid(`${String(argument)} requires a value\n\n${USAGE}`);
            }
            index += 1;
            return next;
        };
        if (argument === '--help') {
            return invalid(USAGE);
        }
        if (argument === '--root') {
            root = value();
            continue;
        }
        if (argument === '--evaluation') {
            evaluationPath = value();
            continue;
        }
        if (argument === '--out') {
            outPath = value();
            continue;
        }
        if (argument === '--detail') {
            detail = 'runs';
            continue;
        }
        if (argument === '--summary') {
            summary = true;
            continue;
        }
        if (argument === '--strict') {
            strict = true;
            continue;
        }
        invalid(`unknown option ${String(argument)}\n\n${USAGE}`);
    }
    return { root, evaluationPath, outPath, detail, summary, strict };
}

/** The stored scan and verification sidecars under one sidecar root, in digest-directory order. */
function sidecarPaths(sidecarRoot: string): { path: string; kind: 'scan' | 'verification' }[] {
    if (!existsSync(sidecarRoot)) {
        return [];
    }
    const found: { path: string; kind: 'scan' | 'verification' }[] = [];
    for (const entry of readdirSync(sidecarRoot).sort()) {
        const directory = join(sidecarRoot, entry);
        if (!statSync(directory).isDirectory()) {
            continue;
        }
        for (const [name, kind] of [
            ['scan.json', 'scan'],
            ['verification.json', 'verification'],
        ] as const) {
            const path = join(directory, name);
            if (existsSync(path)) {
                found.push({ path, kind });
            }
        }
    }
    return found;
}

/** The review dossiers under one bundle root, in bundle-directory order. */
function dossierPaths(reviewBundleRoot: string): string[] {
    if (!existsSync(reviewBundleRoot)) {
        return [];
    }
    const found: string[] = [];
    for (const entry of readdirSync(reviewBundleRoot).sort()) {
        const path = join(reviewBundleRoot, entry, 'dossier.json');
        if (existsSync(path)) {
            found.push(path);
        }
    }
    return found;
}

/** Reads one artifact, or refuses in strict mode and reports the refusal as a skip otherwise. */
function readArtifact<TArtifact>(input: {
    readonly path: string;
    readonly strict: boolean;
    readonly skipped: SkippedArtifact[];
    readonly read: () => TArtifact;
}): TArtifact | undefined {
    try {
        return input.read();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (input.strict) {
            return invalid(`${input.path} could not be read: ${reason}`);
        }
        input.skipped.push({ path: input.path, reason });
        return undefined;
    }
}

function readDossiers(input: {
    readonly reviewBundleRoot: string;
    readonly strict: boolean;
    readonly skipped: SkippedArtifact[];
}): StoredDossier[] {
    const dossiers: StoredDossier[] = [];
    for (const path of dossierPaths(input.reviewBundleRoot)) {
        const dossier = readArtifact({
            path,
            strict: input.strict,
            skipped: input.skipped,
            read: (): ReviewDossier => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
                } catch (error) {
                    return invalid(
                        `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return parseReviewDossier(parsed);
            },
        });
        if (dossier !== undefined) {
            dossiers.push({ path, dossier });
        }
    }
    return dossiers;
}

function readStoredRuns(input: {
    readonly sidecarRoot: string;
    readonly dossiers: readonly StoredDossier[];
    readonly strict: boolean;
    readonly skipped: SkippedArtifact[];
}): { runs: MeasurementRun[]; extras: RecordExtras } {
    const runs: MeasurementRun[] = [];
    let extras = emptyRecordExtras();
    for (const entry of sidecarPaths(input.sidecarRoot)) {
        const report = readArtifact({
            path: entry.path,
            strict: input.strict,
            skipped: input.skipped,
            read: (): SemanticReport =>
                parseReportJson(readFileSync(entry.path, 'utf8'), `semantic report at ${entry.path}`),
        });
        if (report === undefined) {
            continue;
        }
        extras = addReportExtras(extras, report);
        runs.push(
            aggregateStoredReport({
                artifact: { kind: entry.kind, path: entry.path, sha256: sha256Of(entry.path) },
                report,
                dossiers: input.dossiers,
            })
        );
    }
    return { runs, extras };
}

function sha256Of(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return invalid(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        return invalid(`${label} must be a non-empty string`);
    }
    return value;
}

function readBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
        return invalid(`${label} must be a boolean`);
    }
    return value;
}

function readCount(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        return invalid(`${label} must be a non-negative safe integer`);
    }
    return value as number;
}

function readFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(`${label} must be a finite number`);
    }
    return value;
}

function readStrings(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) {
        return invalid(`${label} must be an array`);
    }
    return value.map((entry, index) => readString(entry, `${label}[${String(index)}]`));
}

function readUsage(value: unknown, label: string): SemanticUsageReport {
    const record = asRecord(value, label);
    return {
        networkAttempts: readCount(record.networkAttempts, `${label}.networkAttempts`),
        logicalRequests: readCount(record.logicalRequests, `${label}.logicalRequests`),
        retries: readCount(record.retries, `${label}.retries`),
        submittedBytes: readCount(record.submittedBytes, `${label}.submittedBytes`),
        actualInputTokens: readCount(record.actualInputTokens, `${label}.actualInputTokens`),
        estimatedInputTokens: readCount(record.estimatedInputTokens, `${label}.estimatedInputTokens`),
        attemptsWithUnknownUsage: readCount(record.attemptsWithUnknownUsage, `${label}.attemptsWithUnknownUsage`),
        estimatedCostUsd: readFiniteNumber(record.estimatedCostUsd, `${label}.estimatedCostUsd`),
        pricingConfigurationVersion: readString(
            record.pricingConfigurationVersion,
            `${label}.pricingConfigurationVersion`
        ),
    };
}

function readFixture(value: unknown, label: string): EvaluationFixtureOutcome {
    const record = asRecord(value, label);
    if (!Array.isArray(record.rulesNotAsked)) {
        return invalid(`${label}.rulesNotAsked must be an array`);
    }
    if (!Array.isArray(record.outcomes)) {
        return invalid(`${label}.outcomes must be an array`);
    }
    return {
        fixtureId: readString(record.fixtureId, `${label}.fixtureId`),
        kind: readString(record.kind, `${label}.kind`),
        path: readString(record.path, `${label}.path`),
        ruleId: readString(record.ruleId, `${label}.ruleId`),
        sourceKind: readString(record.sourceKind, `${label}.sourceKind`),
        execution: readString(record.execution, `${label}.execution`),
        failureCode: typeof record.failureCode === 'string' ? record.failureCode : undefined,
        requestedModel: readString(record.requestedModel, `${label}.requestedModel`),
        returnedModels: readStrings(record.returnedModels, `${label}.returnedModels`),
        rulesAsked: readStrings(record.rulesAsked, `${label}.rulesAsked`),
        rulesNotAsked: record.rulesNotAsked.map((entry, index) => {
            const at = `${label}.rulesNotAsked[${String(index)}]`;
            const notAsked = asRecord(entry, at);
            return {
                ruleId: readString(notAsked.ruleId, `${at}.ruleId`),
                missingEvidence: readStrings(notAsked.missingEvidence, `${at}.missingEvidence`),
            };
        }),
        evidenceSupplied: readStrings(record.evidenceSupplied, `${label}.evidenceSupplied`),
        missingEvidenceByRule: Object.fromEntries(
            Object.entries(asRecord(record.missingEvidenceByRule, `${label}.missingEvidenceByRule`)).map(
                ([ruleId, tokens]) => [ruleId, readStrings(tokens, `${label}.missingEvidenceByRule.${ruleId}`)]
            )
        ),
        outcomes: record.outcomes.map((entry, index) => {
            const at = `${label}.outcomes[${String(index)}]`;
            const outcome = asRecord(entry, at);
            return {
                ruleId: readString(outcome.ruleId, `${at}.ruleId`),
                outcome: readString(outcome.outcome, `${at}.outcome`),
                probability: readFiniteNumber(outcome.probability, `${at}.probability`),
                disposition: readString(outcome.disposition, `${at}.disposition`),
                reasoning: typeof outcome.reasoning === 'string' ? outcome.reasoning : '',
            };
        }),
        expectedConcernHeld: readBoolean(record.expectedConcernHeld, `${label}.expectedConcernHeld`),
        otherSignals: readStrings(record.otherSignals, `${label}.otherSignals`),
        providerRequests: readCount(record.providerRequests, `${label}.providerRequests`),
        usage: readUsage(record.usage, `${label}.usage`),
        limitations: readStrings(record.limitations, `${label}.limitations`),
    };
}

/** The evaluation runner's outcome file: its `SemanticEvaluationResult`, or the fixture array itself. */
function readEvaluationOutcome(path: string): EvaluationFixtureOutcome[] {
    if (!existsSync(path)) {
        return invalid(`there is no evaluation outcome file at ${path}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        return invalid(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const outcomes = Array.isArray(parsed) ? parsed : asRecord(parsed, path).outcomes;
    if (!Array.isArray(outcomes)) {
        return invalid(`${path} carries no outcomes array; it is not the evaluation runner's outcome file`);
    }
    return outcomes.map((entry, index) => readFixture(entry, `${path} outcomes[${String(index)}]`));
}

export type MeasurementInputs = {
    readonly runs: readonly MeasurementRun[];
    readonly skippedArtifacts: readonly SkippedArtifact[];
    readonly extras: RecordExtras;
    /** The reader's own half of the provenance; the detail level and the note are the caller's. */
    readonly sources: Omit<MeasurementSources, 'note' | 'detail'>;
};

export function readMeasurementInputs(input: {
    readonly sidecarRoot: string;
    readonly reviewBundleRoot: string;
    readonly evaluationOutcomePath: string | null;
    readonly strict: boolean;
}): MeasurementInputs {
    const skipped: SkippedArtifact[] = [];
    const dossiers = readDossiers({ reviewBundleRoot: input.reviewBundleRoot, strict: input.strict, skipped });
    const stored = readStoredRuns({
        sidecarRoot: input.sidecarRoot,
        dossiers,
        strict: input.strict,
        skipped,
    });
    const fixtures = input.evaluationOutcomePath === null ? [] : readEvaluationOutcome(input.evaluationOutcomePath);
    const runs = [...stored.runs];
    let extras = stored.extras;
    for (const fixture of fixtures) {
        // A fixture is a run like any other: its rules, texts and signals reach the set-wide
        // vocabularies through the same fold the stored reports use.
        extras = addFixtureExtras(extras, fixture);
        runs.push(
            aggregateEvaluationFixture({
                artifact: {
                    kind: 'evaluation-fixture',
                    path: `${String(input.evaluationOutcomePath)}#${fixture.fixtureId}`,
                    sha256: sha256Of(String(input.evaluationOutcomePath)),
                },
                fixture,
            })
        );
    }
    return {
        runs,
        skippedArtifacts: skipped,
        extras,
        sources: {
            sidecarRoot: input.sidecarRoot,
            sidecarRootPresent: existsSync(input.sidecarRoot),
            reviewBundleRoot: input.reviewBundleRoot,
            reviewBundleRootPresent: existsSync(input.reviewBundleRoot),
            evaluationOutcomePath: input.evaluationOutcomePath,
            storedRunsRead: stored.runs.length,
            dossiersRead: dossiers.length,
            evaluationFixturesRead: fixtures.length,
        },
    };
}

/** A count record as `name n, name n`, so a summary line names each state rather than a total. */
function describeCounts(counts: Readonly<Record<string, number>>): string {
    const entries = Object.entries(counts).map(([name, count]) => `${name} ${String(count)}`);
    if (entries.length === 0) {
        return 'none recorded';
    }
    return entries.join(', ');
}

/**
 * The omission totals and where they came from. A record whose artifacts carry no scope ledger says so
 * instead of printing a row of zeros that reads as a run which omitted nothing.
 */
function describeOutcomeStates(across: AcrossRuns): string {
    if (across.publishedOutcomeRuns > 0 && across.publishedOutcomeStates !== null) {
        return `outcome states (published by ${String(across.publishedOutcomeRuns)} run(s)): ${describeStates(across.publishedOutcomeStates)}`;
    }
    if (across.derivedOutcomeRuns > 0 && across.derivedOutcomeStates !== null) {
        return `outcome states (derived from ${String(across.derivedOutcomeRuns)} run(s)): ${describeStates(across.derivedOutcomeStates)}`;
    }
    return 'outcome states: no artifact read carries a scope ledger';
}

function describeStates(states: SemanticScopeStates): string {
    return `notApplicable ${String(states.notApplicable)}, excludedWithAssessmentOwed ${String(states.excludedWithAssessmentOwed)}, missingRequiredEvidence ${String(states.missingRequiredEvidence)}, omittedForBudgetOrDeadline ${String(states.omittedForBudgetOrDeadline)}, providerFailure ${String(states.providerFailure)}, dryRun ${String(states.dryRun)}`;
}

function mebibytes(bytes: number): string {
    const mebibyteCount = bytes / (1024 * 1024);
    return `${mebibyteCount.toFixed(1)} MiB`;
}

/**
 * The human reading of the record. Every line names the figures it prints; none of them is a verdict.
 *
 * The two derived spans are computed before the lines that print them on purpose: a division inside a
 * template interpolation after a parenthesized member expression (`${(a.b / c)}`) sends the trusted
 * snapshot's import scanner (`snapshotImportSpecifiers` in `scripts/trustedGithubWriteBootstrap.ts`)
 * into unbounded recursion, and the advisory semantic review scans this file as a changed path. That
 * scanner defect is reported rather than worked around silently; this file simply does not feed it.
 */
export function renderMeasurementSummary(record: MeasurementRecord): string {
    const { acrossRuns: across, sources } = record;
    const wallClockSeconds = (across.wallClockMs / 1000).toFixed(1);
    const lines = [
        `semantic review measurement — ${record.format} — ${record.measuredAt}`,
        `sources: ${String(sources.storedRunsRead)} stored run(s) under ${sources.sidecarRoot}, ${String(sources.dossiersRead)} dossier(s) under ${sources.reviewBundleRoot}, ${String(sources.evaluationFixturesRead)} evaluation fixture(s)`,
        `runs: ${String(across.runCount)} (${Object.entries(across.runCountByKind)
            .map(([kind, count]) => `${kind} ${String(count)}`)
            .join(', ')})`,
        `rule coverage: ${String(across.ruleCoverage.applicableRules)} applicable, ${String(across.ruleCoverage.askedRules)} asked, ${String(across.ruleCoverage.notAskedRules)} not asked (${Object.entries(
            across.ruleCoverage.notAskedByReason
        )
            .map(([reason, count]) => `${reason} ${String(count)}`)
            .join(', ')})`,
        `evidence: ${String(across.evidence.unitsMissingRequiredEvidence)} unit(s) missing required evidence, ${String(across.evidence.truncatedRegions)} truncated region(s) over ${String(across.evidence.truncatedPaths)} path(s)`,
        describeOutcomeStates(across),
        `execution states: ${describeCounts(across.executionStates)}`,
        `failure codes: ${describeCounts(across.failureCodes)}`,
        `usage: ${String(across.usage.networkAttempts)} network attempt(s), ${mebibytes(across.usage.submittedBytes)} submitted, ${String(across.usage.actualInputTokens)} input token(s), ~$${across.usage.estimatedCostUsd.toFixed(4)}, ${String(across.usage.cacheHits)} cache hit(s)`,
        `wall clock: ${wallClockSeconds} s over ${String(across.wallClockRuns)} run(s), from their own startedAt/completedAt`,
        `signals: ${String(across.signals.total)} (${Object.entries(across.signals.byDisposition)
            .map(([disposition, count]) => `${disposition} ${String(count)}`)
            .join(', ')})`,
        `review rounds: ${String(across.reviewRounds.heads)} head(s) with a dossier, ${String(across.reviewRounds.stanceDraws)} draw(s), ${String(across.reviewRounds.findingsAccepted)} finding(s) accepted, ${String(across.reviewRounds.findingsDiscarded)} discarded`,
        `dispositions: ${String(across.signalDispositions.recorded)} recorded, ${String(across.signalDispositions.dismissedFiredSignals)} fired signal(s) dismissed, ${String(across.signalDispositions.undismissedFiredSignals)} undismissed on heads with a dossier, ${String(across.signalDispositions.withoutDossier)} on heads with none`,
        `repeated warnings: ${String(across.repeatedWarnings.length)} (ruleId, path) pair(s) flagged on more than one head of one pull request`,
    ];
    if (across.labelledExpectations !== null) {
        lines.push(
            `labelled expectations: ${String(across.labelledExpectations.held)}/${String(across.labelledExpectations.total)} held — a count about the rules and the provider, not an accuracy figure`
        );
    }
    lines.push(`skipped artifacts: ${String(record.skippedArtifacts.length)}`);
    lines.push(`not computable: ${String(record.notComputable.length)} figure(s) named in the record's notComputable`);
    return lines.join('\n');
}

/**
 * The whole measurement, from one checkout root to one record.
 *
 * A root that yields no run at all is refused rather than recorded: a record whose every figure was
 * computed from nothing would look exactly like one measured over a clean tree.
 */
export function measureCheckout(input: {
    readonly root: string;
    readonly evaluationOutcomePath: string | null;
    readonly strict: boolean;
    readonly detail: MeasurementDetail;
    readonly measuredAt: string;
    readonly machine: MeasurementMachine;
}): MeasurementRecord {
    const inputs = readMeasurementInputs({
        sidecarRoot: join(input.root, '.agents', SEMANTIC_SIDECAR_DIRECTORY),
        reviewBundleRoot: join(input.root, '.agents', 'review-bundles'),
        evaluationOutcomePath: input.evaluationOutcomePath,
        strict: input.strict,
    });
    if (inputs.runs.length === 0) {
        throw new MeasurementFailure(
            'nothing_to_measure',
            `no stored sidecar, dossier, or evaluation outcome was read under ${input.root}; refusing to record figures nothing stands behind`
        );
    }
    return buildMeasurementRecord({
        measuredAt: input.measuredAt,
        machine: input.machine,
        sources: {
            ...inputs.sources,
            detail: input.detail,
            note: 'retained artifacts from earlier work in this checkout, not a controlled experiment; each run is the pipeline run that wrote the artifact',
        },
        runs: inputs.runs,
        skippedArtifacts: inputs.skippedArtifacts,
        extras: inputs.extras,
    });
}

async function main(): Promise<number> {
    try {
        const parsed = parseCommandLine(process.argv.slice(2));
        const record = measureCheckout({
            root: resolve(parsed.root ?? primaryRoot()),
            evaluationOutcomePath: parsed.evaluationPath === undefined ? null : resolve(parsed.evaluationPath),
            strict: parsed.strict,
            detail: parsed.detail,
            measuredAt: new Date().toISOString(),
            machine: machineProvenance(),
        });
        if (parsed.summary) {
            console.log(renderMeasurementSummary(record));
            return EXIT_OK;
        }
        if (parsed.outPath === undefined) {
            process.stdout.write(`${JSON.stringify(record, null, 4)}\n`);
            return EXIT_OK;
        }
        writeRecord(parsed.outPath, record);
        console.log(renderMeasurementSummary(record));
        return EXIT_OK;
    } catch (error) {
        if (error instanceof MeasurementFailure) {
            console.error(`review:semantic:measure: ${error.code}: ${error.message}`);
            return error.code === 'nothing_to_measure' ? EXIT_NOTHING_TO_MEASURE : EXIT_INVALID;
        }
        console.error(error instanceof Error ? error.message : String(error));
        return EXIT_INVALID;
    }
}

/** The primary checkout, where the pipeline writes its sidecars; a lane worktree reads them from there. */
function primaryRoot(): string {
    try {
        return resolvePrimaryRoot();
    } catch {
        return process.cwd();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}

export { parseCommandLine, readEvaluationOutcome };
