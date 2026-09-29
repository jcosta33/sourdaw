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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
    'Exit codes: 0 every labelled expectation held, 1 a label or a scope was not as recorded, 2 invalid',
    'invocation, 3 the provider did not deliver an assessment.',
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

/**
 * The API key comes from the environment, or from the primary root's gitignored dotenv file, exactly as
 * `review:semantic` resolves it. It is never printed, never written into an outcome, and never cached.
 */
function loadApiKey(primaryRoot: string): string {
    const fromEnv = process.env[TYPESAFE_API_KEY_ENV];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
        return fromEnv.trim();
    }
    const path = `${primaryRoot}/.env.sourdaw-semantic`;
    if (existsSync(path)) {
        const value = parseDotenv(readFileSync(path, 'utf8'))[TYPESAFE_API_KEY_ENV];
        if (value !== undefined && value.trim() !== '') {
            return value.trim();
        }
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

function exitCodeForFailure(code: SemanticFailureCode): number {
    return code === 'unsupported_scope' || code === 'invalid_response' ? EXIT_INVALID : EXIT_INCOMPLETE;
}

/**
 * Writes the outcome file the measurement command reads. Exported so the suite drives the same write the
 * entry point does: a case that serialized the result itself would stay green if this call site wrapped it
 * in an envelope again, which is exactly how the two commands came to disagree.
 */
export function writeEvaluationOutcomes(outPath: string, result: SemanticEvaluationResult): void {
    writeFileSync(outPath, serializeEvaluationOutcomes(result));
}

/**
 * A label that did not hold, or a scope that was not delivered, is not an exit-zero run. Exported so the
 * suite can pin that a negative the provider fires is reported as not held and exits nonzero, instead of
 * trusting the entry point's own reading of the same value.
 */
export function exitCodeFor(result: SemanticEvaluationResult): number {
    if (result.outcomes.some((outcome) => !outcome.expectedConcernHeld)) {
        return EXIT_MISMATCH;
    }
    const undelivered = result.outcomes.some(
        (outcome) => outcome.execution !== 'completed' && outcome.execution !== 'skipped'
    );
    return undelivered ? EXIT_INCOMPLETE : EXIT_OK;
}

async function main(): Promise<number> {
    try {
        assertEvaluationIsOptIn();
        const primaryRoot = resolvePrimaryRoot();
        const parsed = parseEvaluationArgs(process.argv.slice(2));
        const corpus = readCorpus(parsed.corpusPath);
        const profile: SemanticBudgetProfile = SEMANTIC_BUDGET_PROFILES[parsed.profile];
        assertBudgetProfile(profile);
        const controller = new AbortController();
        const result = await runEvaluation({
            corpus,
            ports: {
                provider: createSdkProviderPort({ apiKey: loadApiKey(primaryRoot) }),
                // A fresh memory cache per run: an evaluation observes the provider, and reading another
                // run's stored answer would report that run's outcome under this run's identity.
                cache: createMemoryCache(),
                clock: { now: () => Date.now() },
                signal: controller.signal,
                log: (message) => console.log(message),
            },
            profile,
            planFor: planForFixture({ primaryRoot, gitSource: createGitSourcePort(primaryRoot) }),
            runId: `evaluation-${new Date().toISOString()}`,
        });
        console.log(renderEvaluation(result));
        if (parsed.outPath !== undefined) {
            // The measurement reader reads this file as the result itself, so the writer writes exactly
            // that: an envelope here left `pnpm review:semantic:measure --evaluation` refusing the file
            // this command had just written.
            writeEvaluationOutcomes(parsed.outPath, result);
            console.log(`outcomes: ${parsed.outPath}`);
        }
        return exitCodeFor(result);
    } catch (error) {
        if (error instanceof SemanticFailure) {
            console.error(`review:semantic:evaluate: ${error.code}: ${error.message}`);
            return exitCodeForFailure(error.code);
        }
        console.error(error instanceof Error ? error.message : String(error));
        return EXIT_INVALID;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}
