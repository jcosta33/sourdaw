#!/usr/bin/env node
/**
 * `pnpm review:semantic:evaluate` — the OPT-IN live evaluation of the adjudicated semantic-review corpus.
 *
 * It drives `runScan` once per corpus fixture with the real Git source and the real TypeSafe provider, and
 * prints what each fixture's request carried — model, rules asked, evidence supplied and missing,
 * thresholds, the deterministic change facts — and what came back raw. It never publishes, never approves,
 * and never runs in CI: the semantic-review workflow has its own command, and this one spends money.
 *
 * The corpus beside it holds two human-adjudicated negatives from real revisions and two authored
 * synthetic positives. A negative is a change the rule under test must stay quiet about; a positive is one
 * it must fire on. No label in the corpus is a model score, and an outcome here is evidence about the
 * provider and the rules rather than about any change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseDotenv, resolvePrimaryRoot } from './githubAppIdentity.ts';
import { refuse, SemanticFailure, type SemanticFailureCode } from './semanticReview/contracts.ts';
import {
    parseEvaluationCorpus,
    restrictSourceToPath,
    SEMANTIC_EVALUATION_CORPUS_PATH,
    syntheticFixtureSource,
    type EvaluationCorpus,
    type EvaluationFixture,
} from './semanticReview/evaluation/corpus.ts';
import {
    fixtureEvaluationRevision,
    renderEvaluation,
    runEvaluation,
    serializeEvaluationOutcomes,
    type EvaluationFixturePlan,
    type SemanticEvaluationPorts,
    type SemanticEvaluationResult,
} from './semanticReview/evaluation/runEvaluation.ts';
import { createGitSourcePort, resolveFromRefs } from './semanticReview/gitSource.ts';
import { createMemoryCache, createSdkProviderPort, TYPESAFE_API_KEY_ENV } from './semanticReview/provider.ts';
import {
    assertBudgetProfile,
    SEMANTIC_BUDGET_PROFILES,
    type SemanticBudgetProfile,
    type SemanticProfileName,
} from './semanticReview/rules.ts';

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_INVALID = 2;
const EXIT_INCOMPLETE = 3;

const USAGE = [
    'Usage: pnpm review:semantic:evaluate [options]',
    '',
    'Assesses every fixture of the adjudicated corpus with the real Git source and the real provider.',
    'Opt-in only: this command is never run by CI and must never run from a unit test.',
    '',
    'Options:',
    '  --profile <ci|local>  Budget profile. Default ci, the profile the advisory review runs under;',
    "                        the local profile's 16 KiB state ceiling leaves a fourteen-rule unit no",
    '                        evidence budget, so its rules are never asked.',
    '  --corpus <path>       Read another corpus file. Default the shipped corpus.',
    '  --out <path>          Also write the raw outcomes here as JSON.',
    '',
    `Requires ${TYPESAFE_API_KEY_ENV} in the environment or in <primary-root>/.env.sourdaw-semantic.`,
    'Exit codes: 0 every fixture was assessed and every labelled expectation held, 1 a delivered',
    'assessment whose label or scope was not as recorded, 2 an invocation the command refused, 3 an',
    'assessment that was not delivered - a fixture no request assessed, a provider that failed or',
    'answered unusably, or a source read that failed. Non-delivery outranks a disagreement: a run that',
    'assessed nothing exits 3 however the labels it never asked would read. An --out file that cannot be',
    "written is reported on stderr and leaves the run's own exit in place: it is not an assessment.",
].join('\n');

export type ParsedEvaluationArgs = {
    readonly profile: SemanticProfileName;
    readonly corpusPath: string;
    readonly outPath?: string;
};

function profileOption(value: string): SemanticProfileName {
    if (value === 'ci' || value === 'local') {
        return value;
    }
    return refuse('unsupported_scope', `--profile must be ci or local\n\n${USAGE}`);
}

function optionValue(argv: readonly string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (value === undefined) {
        refuse('unsupported_scope', `${option} needs a value\n\n${USAGE}`);
    }
    return value;
}

export function parseEvaluationArgs(argv: readonly string[]): ParsedEvaluationArgs {
    // The ci profile is the shipped advisory-review profile, and the one the fixtures are answerable
    // under: the local profile's state ceiling is smaller than a fourteen-rule unit's own questions.
    let profile: SemanticProfileName = 'ci';
    let corpusPath = SEMANTIC_EVALUATION_CORPUS_PATH;
    let outPath: string | undefined;
    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        if (option === '--profile') {
            profile = profileOption(optionValue(argv, index, '--profile'));
            index += 1;
            continue;
        }
        if (option === '--corpus') {
            corpusPath = optionValue(argv, index, '--corpus');
            index += 1;
            continue;
        }
        if (option === '--out') {
            outPath = optionValue(argv, index, '--out');
            index += 1;
            continue;
        }
        refuse('unsupported_scope', `unknown option ${option ?? ''}\n\n${USAGE}`);
    }
    return outPath === undefined ? { profile, corpusPath } : { profile, corpusPath, outPath };
}

/**
 * The evaluation never runs in CI, and never inside a unit test. CI has the advisory scan, which holds its
 * own budget and publishes nothing; a test that reached this file would spend money on a network call the
 * suite is not allowed to make. Exported so the suite pins the guard rather than trusting the entry point,
 * and the environment is a parameter because a test that read the ambient one asserted whichever refusal
 * happened to win the order — under CI this suite has `CI` set too, and it must still be told it is a test.
 */
export function assertEvaluationIsOptIn(environment: NodeJS.ProcessEnv = process.env): void {
    if (environment.VITEST !== undefined) {
        refuse('unsupported_scope', 'the live semantic evaluation must never run from a unit test');
    }
    const ci = environment.CI;
    if (ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0') {
        refuse('unsupported_scope', 'the live semantic evaluation is opt-in and never runs in CI');
    }
}

/** The `code` one failed filesystem read reports, or undefined when it reports none. */
function readFailureCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

/**
 * One value from a gitignored dotenv file, or undefined when there is no file to read it from.
 *
 * The read is what decides whether the file is there: only `ENOENT` — no file at that path — is the
 * documented "no dotenv file" path. Every other failure is raised rather than read as an absent credential,
 * a permission the process does not have included, so a file that cannot be read is never reported as a
 * missing key. Nothing probes the path first, which is also what keeps the file from being checked in one
 * call and used in another.
 *
 * Exported, with its reader as a parameter, so the suite drives the classification over every code a read
 * can report rather than only over the ones a portable filesystem can be made to produce.
 */
export function dotenvValue(
    path: string,
    key: string,
    read: (path: string) => string = (source) => readFileSync(source, 'utf8')
): string | undefined {
    let text: string;
    try {
        text = read(path);
    } catch (error) {
        if (readFailureCode(error) === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
    return parseDotenv(text)[key];
}

/**
 * The API key comes from the environment, or from the primary root's gitignored dotenv file, exactly as
 * `review:semantic` resolves it. It is never printed, never written into an outcome, and never cached.
 *
 * Exported, with its environment as a parameter, so the suite pins the resolution and its refusal instead
 * of trusting the entry point: a case reading the ambient environment would assert whichever branch the
 * running shell happened to provide.
 */
export function loadApiKey(primaryRoot: string, environment: NodeJS.ProcessEnv = process.env): string {
    const fromEnv = environment[TYPESAFE_API_KEY_ENV];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
        return fromEnv.trim();
    }
    const path = `${primaryRoot}/.env.sourdaw-semantic`;
    const value = dotenvValue(path, TYPESAFE_API_KEY_ENV);
    if (value !== undefined && value.trim() !== '') {
        return value.trim();
    }
    return refuse(
        'missing_credentials',
        `refusing to call TypeSafe: ${TYPESAFE_API_KEY_ENV} is not set in the environment or in ${path}`
    );
}

function readCorpus(path: string): EvaluationCorpus {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        return refuse('unsupported_scope', `no readable evaluation corpus at ${path}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch {
        return refuse('unsupported_scope', `the evaluation corpus at ${path} is not JSON`);
    }
    return parseEvaluationCorpus(parsed, `evaluation corpus at ${path}`);
}

/**
 * What one fixture is assessed over. The two adjudicated negatives are real revisions, so their regions
 * come from Git restricted to the fixture's path; a synthetic positive's text, hunks, and changed lines
 * are the corpus's own, and its revision pair is the synthetic one no Git object holds.
 */
function planForFixture(input: {
    readonly primaryRoot: string;
    readonly gitSource: ReturnType<typeof createGitSourcePort>;
}): (fixture: EvaluationFixture) => EvaluationFixturePlan {
    const revisions = new Map<string, EvaluationFixturePlan['revision']>();
    return (fixture) => {
        if (fixture.fixture === 'synthetic-positive') {
            return {
                source: syntheticFixtureSource(fixture),
                sourceKind: 'corpus-fixture',
                revision: fixtureEvaluationRevision(fixture),
            };
        }
        const key = `${fixture.revisions.mergeBaseSha}:${fixture.revisions.headSha}`;
        let revision = revisions.get(key);
        if (revision === undefined) {
            revision = resolveFromRefs(
                input.primaryRoot,
                fixture.revisions.mergeBaseSha,
                fixture.revisions.headSha
            ).revision;
            revisions.set(key, revision);
        }
        return {
            source: restrictSourceToPath(input.gitSource, fixture.path),
            sourceKind: 'git-revisions',
            revision,
        };
    };
}

/**
 * The exit code one typed refusal earns: the invalid-invocation code is for an invocation the command
 * itself refused — an unknown option, an unsupported profile, a corpus it could not read or parse, a run
 * started where the evaluation is not admitted. Every other code is an assessment that was not delivered,
 * the provider's own answer contract included, and reports the incomplete exit.
 */
function exitCodeForFailure(code: SemanticFailureCode): number {
    return code === 'unsupported_scope' ? EXIT_INVALID : EXIT_INCOMPLETE;
}

/**
 * Writes the outcome file the measurement command reads: the result itself, never an envelope. Answers
 * whether it was written; a write that fails is printed and reported as `false` instead of thrown, so the
 * caller that asked for the file is told it is absent while the run keeps the exit its assessment earned —
 * the documented codes describe the assessment, and a file the command could not write is not an assessment
 * that was not delivered.
 */
function writeEvaluationOutcomes(outPath: string, result: SemanticEvaluationResult): boolean {
    try {
        writeFileSync(outPath, serializeEvaluationOutcomes(result));
        return true;
    } catch (error) {
        console.error(
            `review:semantic:evaluate: the outcomes file ${outPath} was not written: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * The exit code one thrown failure earns, shared by the entry point and the command body.
 *
 * A refusal the command states keeps its own code; anything else is a run that delivered nothing — a
 * source whose read failed, a bug in the command — and that is the incomplete exit, never the
 * invalid-invocation one: a failure at run time is not a misspelled invocation.
 */
function failureExit(error: unknown): number {
    if (error instanceof SemanticFailure) {
        console.error(`review:semantic:evaluate: ${error.code}: ${error.message}`);
        return exitCodeForFailure(error.code);
    }
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_INCOMPLETE;
}

/**
 * The run's exit code, in the priority the usage table names: non-delivery first, then disagreement.
 *
 * "Not delivered" is one fixture's own report that its execution is not `completed` — a provider that
 * failed or refused requests, a unit no request could ask, a scope the fitter had to reduce, a source that
 * reported no changed file for the fixture at all, which is the `skipped` state. Such a run carries an
 * assessment nobody made, so it exits 3 whatever its labels read: `skipped` counted as delivery let a run
 * that assessed nothing fall through to the disagreement exit, which the usage table does not promise.
 *
 * A run that delivered every fixture keeps the distinction: a label that did not hold still exits 1, and
 * only a fully assessed, held run exits 0.
 *
 * Exported so the suite pins the negative a provider fires as reported not held and exited 1, and a
 * provider that delivers nothing as exited 3, instead of trusting the entry point's own reading.
 */
export function exitCodeFor(result: SemanticEvaluationResult): number {
    const assessedEveryFixture = result.outcomes.every((outcome) => outcome.execution === 'completed');
    if (!assessedEveryFixture) {
        return EXIT_INCOMPLETE;
    }
    if (result.outcomes.some((outcome) => !outcome.expectedConcernHeld)) {
        return EXIT_MISMATCH;
    }
    return EXIT_OK;
}

/**
 * The command's whole body once its environment is known: parse the invocation, read the corpus, run the
 * evaluation, render the report, and write the outcome file the measurement command reads. It answers with
 * `exitCodeFor`'s own code for a completed run — non-delivery outranking a disagreement — and with
 * `failureExit`'s for a refusal, which is why the usage table lists 2 beside the three run outcomes.
 *
 * The source port factory, the ports, the log, and the arguments are parameters so the suite drives this
 * exact path — including the `--out` write — with stubs. A case that called a write helper of its own could
 * not see the branch that actually writes the file, which is where the writer and the reader came to
 * disagree.
 */
export async function runEvaluationCommand(input: {
    readonly argv: readonly string[];
    readonly sourceFor: (fixture: EvaluationFixture) => EvaluationFixturePlan;
    readonly portsFor: () => SemanticEvaluationPorts;
    readonly log: (message: string) => void;
}): Promise<number> {
    try {
        const parsed = parseEvaluationArgs(input.argv);
        const corpus = readCorpus(parsed.corpusPath);
        const profile: SemanticBudgetProfile = SEMANTIC_BUDGET_PROFILES[parsed.profile];
        assertBudgetProfile(profile);
        const result = await runEvaluation({
            corpus,
            ports: input.portsFor(),
            profile,
            planFor: input.sourceFor,
            runId: `evaluation-${new Date().toISOString()}`,
        });
        input.log(renderEvaluation(result));
        if (parsed.outPath !== undefined) {
            // The measurement reader reads this file as the result itself, so the command writes exactly
            // that: an envelope here left `pnpm review:semantic:measure --evaluation` refusing the file this
            // command had just written. A write that fails is reported by the writer and does not change the
            // exit: the run's own code describes the assessment, not the file.
            if (writeEvaluationOutcomes(parsed.outPath, result)) {
                input.log(`outcomes: ${parsed.outPath}`);
            }
        }
        return exitCodeFor(result);
    } catch (error) {
        return failureExit(error);
    }
}

async function main(): Promise<number> {
    try {
        assertEvaluationIsOptIn();
        const primaryRoot = resolvePrimaryRoot();
        const controller = new AbortController();
        const gitSource = createGitSourcePort(primaryRoot);
        return await runEvaluationCommand({
            argv: process.argv.slice(2),
            sourceFor: planForFixture({ primaryRoot, gitSource }),
            portsFor: () => ({
                provider: createSdkProviderPort({ apiKey: loadApiKey(primaryRoot) }),
                // A fresh memory cache per run: an evaluation observes the provider, and reading another
                // run's stored answer would report that run's outcome under this run's identity.
                cache: createMemoryCache(),
                clock: { now: () => Date.now() },
                signal: controller.signal,
                log: (message) => console.log(message),
            }),
            log: (message) => console.log(message),
        });
    } catch (error) {
        return failureExit(error);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}
