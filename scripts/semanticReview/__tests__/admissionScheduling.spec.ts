/**
 * Admission scheduling and question membership.
 *
 * Two defects are pinned here. Admission walked the plan in path order, so a bound budget or deadline
 * omitted whichever units sorted last — test churn as readily as a realtime unit, and a rename could
 * move a unit across that line. And every pass was asked every rule's question, including rules whose
 * required evidence the request did not carry, so those answers were paid for and then discarded by
 * the interpreter. The cases below read the published order and totals, the request each unit actually
 * sends, and the ledger a skipped request leaves behind.
 */

import { APITimeoutError } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';

import { type SemanticRevisionBase, type SemanticScopeExclusion } from '../contracts.ts';
import {
    collectEvidence,
    type PathHunks,
    type SemanticChangedFile,
    type SemanticEvidenceSet,
    type SemanticSourcePort,
} from '../evidence.ts';
import { answerableRulesForPass, passRequestPayload } from '../passes.ts';
import { computeResponseCacheKey, TYPESAFE_MODEL, type SemanticProviderPort } from '../provider.ts';
import { parseStoredResponses, replayScanSignals } from '../replay.ts';
import { parseReportJson, renderSummary, serializeReport, validateReport } from '../report.ts';
import { SEMANTIC_BUDGET_PROFILES, type SemanticBudgetProfile, type SemanticRuleId } from '../rules.ts';
import { planUnits, runScan, type RunScanInput } from '../run.ts';
import { mergeUnitAnswers } from '../unitAssessment.ts';

const HEAD = 'a'.repeat(40);
const MERGE_BASE = 'b'.repeat(40);
const TARGET_BASE = 'c'.repeat(40);
const TRUSTED = 'd'.repeat(40);

const BASE_REVISION: SemanticRevisionBase = {
    repository: 'jcosta33/sourdaw',
    repositoryId: '1',
    headSha: HEAD,
    targetBaseSha: TARGET_BASE,
    mergeBaseSha: MERGE_BASE,
    trustedExecutionSha: TRUSTED,
    contractSourceSha: MERGE_BASE,
};

/**
 * The collector's own ceilings are lifted in every fixture here, so the only budget in play is the
 * per-request one. A case that wants a region withheld names that as its own cause rather than
 * inheriting it from a limit that has nothing to do with what it asserts.
 */
const LIFTED_LIMITS = { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 };
const OPEN_CAP = SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes;

function changedFile(path: string, overrides: Partial<SemanticChangedFile> = {}): SemanticChangedFile {
    return { path, kind: 'modified', binary: false, generated: false, added: 3, deleted: 1, ...overrides };
}

/** One side of a changed file, supplied whole: the shape `collectEvidence` reads blobs and hunks in. */
function sides(path: string, before: string, after: string): Record<string, string> {
    return { [`${MERGE_BASE}:${path}`]: before, [`${HEAD}:${path}`]: after };
}

function fakeSource(
    files: readonly SemanticChangedFile[],
    blobs: Readonly<Record<string, string>>,
    hunks: ReadonlyMap<string, PathHunks> = new Map()
): SemanticSourcePort {
    return {
        changedFiles: () => files,
        readFile: (sha, path) => blobs[`${sha}:${path}`],
        changedHunks: () => hunks,
    };
}

class MapCache {
    readonly entries = new Map<string, unknown>();
    read = (key: string): unknown => this.entries.get(key);
    write = (key: string, value: unknown): void => {
        this.entries.set(key, value);
    };
}

function fixedClock(start: number): { readonly now: () => number } {
    return { now: () => start };
}

/** A provider that answers every question it is asked, counting the calls it took. */
function countingProvider(answer = 0.05): { port: SemanticProviderPort; calls: () => number } {
    let calls = 0;
    return {
        calls: () => calls,
        port: {
            systemOne: async ({ questions }) => {
                calls += 1;
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: answer };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        },
    };
}

/** A provider that refuses to be called at all: a unit that asks nothing must never reach it. */
function forbiddenProvider(): { port: SemanticProviderPort; calls: () => number } {
    let calls = 0;
    return {
        calls: () => calls,
        port: {
            systemOne: async () => {
                calls += 1;
                throw new Error('a provider call was made for a unit with no answerable question');
            },
        },
    };
}

function scanInput(input: {
    readonly provider: SemanticProviderPort;
    readonly source: SemanticSourcePort;
    readonly cache?: MapCache;
    readonly profile?: SemanticBudgetProfile;
    readonly chain?: boolean;
}): RunScanInput {
    return {
        ports: {
            source: input.source,
            provider: input.provider,
            cache: input.cache ?? new MapCache(),
            clock: fixedClock(1_000),
            signal: new AbortController().signal,
            log: () => undefined,
        },
        revision: BASE_REVISION,
        profile: input.profile ?? SEMANTIC_BUDGET_PROFILES.local,
        limits: LIFTED_LIMITS,
        contractPaths: [],
        runId: 'admission-scheduling-test',
        dryRun: false,
    };
}

/** One unit's evidence as the planner composed it, used to read the request a case builds itself. */
function plannedUnit(files: readonly SemanticChangedFile[], set: SemanticEvidenceSet) {
    const { units } = planUnits(files, set, OPEN_CAP);
    const unit = units[0];
    if (unit === undefined) {
        throw new Error('the fixture planned no unit, so the case would assert nothing');
    }
    return unit;
}

function collectFrom(source: SemanticSourcePort): SemanticEvidenceSet {
    return collectEvidence({
        port: source,
        mergeBaseSha: MERGE_BASE,
        headSha: HEAD,
        contractSourceSha: MERGE_BASE,
        limits: LIFTED_LIMITS,
    });
}

/** The unassessed entries a report records, in the plan's own order. */
function unassessedOf(report: { readonly scope: { readonly unassessed: readonly SemanticScopeExclusion[] } }) {
    return report.scope.unassessed;
}

describe('a binding budget admits the risky unit first, whatever its path', () => {
    const SEVERE_PATH = 'src/modules/AudioEngine/zzz.ts';
    const TEST_PATH = 'electron/__tests__/aaa.spec.ts';

    function twoUnitSource(severePath: string): SemanticSourcePort {
        return fakeSource([changedFile(severePath), changedFile(TEST_PATH)], {
            ...sides(severePath, 'export const a = 1;\n', 'export const a = 2;\n'),
            ...sides(TEST_PATH, 'it("a", () => {});\n', 'it("a", () => {});\nit("b", () => {});\n'),
        });
    }

    it('attempts the severe unit whose path sorts last before the test churn', async () => {
        // The severe unit's path sorts after the spec's, so path order alone would spend the one
        // attempt on the spec; the spec also carries fewer missing-evidence tokens, so only the
        // category key can put the severe unit first. `maxAttempts: 1` makes the order observable.
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: twoUnitSource(SEVERE_PATH),
                profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
            })
        );
        expect(report.scope.assessed).toBe(1);
        expect(report.signals.some((signal) => signal.path === SEVERE_PATH)).toBe(true);
        expect(report.signals.some((signal) => signal.path === TEST_PATH)).toBe(false);
        expect(unassessedOf(report)).toEqual([{ path: TEST_PATH, reason: 'budget_exhausted', priorityClass: 'test' }]);
        expect(provider.calls()).toBe(1);
    });

    it('admits the same units when the severe unit is renamed to sort first', async () => {
        // Renaming the severe unit moves it across the path order and changes nothing else: the class
        // and the evidence it carries are the same, so the admitted set must not move with the name.
        const renamed = 'crates/daw-dsp/src/aaa.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: twoUnitSource(renamed),
                profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
            })
        );
        expect(report.scope.assessed).toBe(1);
        expect(report.signals.some((signal) => signal.path === renamed)).toBe(true);
        expect(report.signals.some((signal) => signal.path === TEST_PATH)).toBe(false);
        expect(unassessedOf(report)).toEqual([{ path: TEST_PATH, reason: 'budget_exhausted', priorityClass: 'test' }]);
    });

    it('attempts a production unit before a test unit that keys identically', async () => {
        // Both units carry exactly one missing-evidence token, so the class is the only key left: a
        // production file can carry the change's behaviour, while a test unit only asks test questions.
        // The spec's path sorts before the production file's, so path order would pick it instead.
        const production = 'electron/main.ts';
        const spec = 'electron/__tests__/main.spec.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource([changedFile(spec), changedFile(production)], {
                    ...sides(production, 'export const a = 1;\n', 'export const a = 2;\n'),
                    ...sides(spec, 'it("a", () => {});\n', 'it("a", () => {});\nit("b", () => {});\n'),
                }),
                profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
            })
        );
        expect(report.scope.requestOrder?.map((entry) => entry.path)).toEqual([production, spec]);
        expect(report.signals.some((signal) => signal.path === production)).toBe(true);
        expect(unassessedOf(report)).toEqual([{ path: spec, reason: 'budget_exhausted', priorityClass: 'test' }]);
    });

    it('orders two units of one class by the fewer missing-evidence tokens, not by path', async () => {
        // Two test units of the same class. The one carrying fewer missing tokens sorts last by path, so
        // only the evidence measure can put it first — and with one attempt it is the one assessed.
        const fewer = 'tests/e2e/zzz.spec.ts';
        const more = 'electron/__tests__/aaa.spec.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource([changedFile(more), changedFile(fewer)], {
                    ...sides(more, 'it("a", () => {});\n', 'it("a", () => {});\nit("b", () => {});\n'),
                    ...sides(fewer, 'it("a", () => {});\n', 'it("a", () => {});\nit("b", () => {});\n'),
                }),
                profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
            })
        );
        const order = report.scope.requestOrder ?? [];
        expect(order.map((entry) => entry.path)).toEqual([fewer, more]);
        expect(order[0]?.missingRequiredEvidenceTokens).toBeLessThan(order[1]?.missingRequiredEvidenceTokens ?? 0);
        expect(report.signals.some((signal) => signal.path === fewer)).toBe(true);
        expect(unassessedOf(report)).toEqual([{ path: more, reason: 'budget_exhausted', priorityClass: 'test' }]);
    });

    it('keeps the production class for a rename across the test boundary', async () => {
        // A rename offers both paths and the planner admits the rules of both. The class reads the same
        // pair: classifying from the destination alone dropped a production file renamed into a test
        // directory behind every production unit, so the rename — not the risk — decided what a binding
        // budget assessed. The renamed unit sorts last and a plain test unit sorts first, so the class is
        // the only thing that can keep the renamed unit admitted.
        const renamedPath = 'electron/__tests__/zzz.spec.ts';
        const previousPath = 'electron/zzz.ts';
        const testPath = 'electron/__tests__/aaa.spec.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource(
                    [changedFile(testPath), changedFile(renamedPath, { kind: 'renamed', previousPath })],
                    {
                        ...sides(testPath, 'it("a", () => {});\n', 'it("a", () => {});\nit("b", () => {});\n'),
                        [`${MERGE_BASE}:${previousPath}`]: 'export const a = 1;\n',
                        [`${HEAD}:${renamedPath}`]: 'export const a = 2;\n',
                    }
                ),
                profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
            })
        );
        const order = report.scope.requestOrder ?? [];
        expect(order.map((entry) => entry.path)).toEqual([renamedPath, testPath]);
        expect(order[0]?.priorityClass).toBe('production');
        expect(report.signals.some((signal) => signal.path === renamedPath)).toBe(true);
        expect(unassessedOf(report)).toEqual([{ path: testPath, reason: 'budget_exhausted', priorityClass: 'test' }]);
    });

    it('keeps the production class when a test is renamed out of the boundary', async () => {
        // The same rule read the other way: a unit is test-only only when every path the change offers
        // is a test path, so a rename out of a test directory is production material like the rename
        // into one — the class cannot flip with the direction of the move.
        const renamedPath = 'electron/zzz.ts';
        const previousPath = 'electron/__tests__/zzz.spec.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource([changedFile(renamedPath, { kind: 'renamed', previousPath })], {
                    [`${MERGE_BASE}:${previousPath}`]: 'it("a", () => {});\n',
                    [`${HEAD}:${renamedPath}`]: 'export const a = 2;\n',
                }),
            })
        );
        const order = report.scope.requestOrder ?? [];
        expect(order.map((entry) => entry.path)).toEqual([renamedPath]);
        expect(order[0]?.priorityClass).toBe('production');
    });

    it('publishes the planned request order with the class and evidence that placed each unit', async () => {
        const provider = countingProvider();
        const { report } = await runScan(scanInput({ provider: provider.port, source: twoUnitSource(SEVERE_PATH) }));
        const order = report.scope.requestOrder ?? [];
        expect(order.map((entry) => entry.path)).toEqual([SEVERE_PATH, TEST_PATH]);
        expect(order.map((entry) => entry.priorityClass)).toEqual(['severe-production', 'test']);
        // The counts are the key's own components: the severe unit carries more missing tokens and is
        // still admitted first, which is what makes the class, not the count, the primary key.
        expect(order[0]?.missingRequiredEvidenceTokens).toBeGreaterThan(order[1]?.missingRequiredEvidenceTokens ?? 0);
        expect(order.map((entry) => entry.answerableRules)).toEqual([expect.any(Number), expect.any(Number)]);
        for (const entry of order) {
            expect(entry.answerableRules).toBeGreaterThan(0);
            expect(entry.ruleIds.length).toBeGreaterThanOrEqual(entry.answerableRules);
        }
    });
});

describe('a unit no pass can ask is never called', () => {
    const PATH = 'crates/daw-dsp/src/big.rs';

    /** A realtime unit whose after side exceeds one request, so no pass supplies both required sides. */
    function unanswerableSource(): SemanticSourcePort {
        return fakeSource(
            [changedFile(PATH, { added: 900, deleted: 1 })],
            sides(PATH, 'const before = 1;\n', 'const sample_value = 1;\n'.repeat(900))
        );
    }

    it('makes zero provider calls and keeps every rule reporting its missing evidence', async () => {
        const provider = forbiddenProvider();
        const { report, storedResponses, previews } = await runScan(
            scanInput({ provider: provider.port, source: unanswerableSource() })
        );
        expect(provider.calls()).toBe(0);
        expect(report.usage.networkAttempts).toBe(0);
        expect(report.usage.submittedBytes).toBe(0);
        expect(report.scope.assessed).toBe(0);
        expect(unassessedOf(report)).toEqual([
            { path: PATH, reason: 'missing-required-evidence', priorityClass: 'severe-production' },
        ]);
        // The whole evidence is still composed for the unit; none of it travels, because no question
        // can be answered from it.
        expect(previews[0]?.evidenceIds.length).toBeGreaterThan(0);
        expect(previews[0]?.sentEvidenceIds).toEqual([]);
        expect(previews[0]?.omissionReason).toBe('missing-required-evidence');
        // The coverage ledger: every rule the unit carries reports the evidence no request supplied.
        const stored = storedResponses[0];
        expect(stored?.answers).toEqual({});
        expect(stored?.passes).toEqual([]);
        expect(stored?.ruleIds.length).toBeGreaterThan(1);
        for (const ruleId of stored?.ruleIds ?? []) {
            const signal = report.signals.find((entry) => entry.path === PATH && entry.ruleId === ruleId);
            expect(signal?.outcome).toBe('insufficient_context');
            expect(signal?.disposition).toBe('unresolved');
            expect(signal?.missingEvidence.length).toBeGreaterThan(0);
            expect(stored?.missingEvidence[ruleId]?.length).toBeGreaterThan(0);
        }
        expect(report.signals.map((signal) => signal.ruleId).sort()).toEqual((stored?.ruleIds ?? []).slice().sort());
    });

    it('still validates and renders, with the omission named in its own state', async () => {
        const provider = forbiddenProvider();
        const { report } = await runScan(scanInput({ provider: provider.port, source: unanswerableSource() }));
        expect(() => validateReport(report)).not.toThrow();
        // The round trip the sidecar takes: the new fields survive serialization and re-validation.
        expect(parseReportJson(serializeReport(report), 'scan.json')).toEqual(report);
        expect(report.scope.states?.missingRequiredEvidence).toBe(1);
        expect(report.execution).not.toBe('completed');
        expect(renderSummary(validateReport(report))).toContain('missing-required-evidence');
    });
});

describe('a pass asks only the questions it carries the evidence for', () => {
    const PATH = 'src/infra/thing.ts';

    function mixedSource(): SemanticSourcePort {
        return fakeSource([changedFile(PATH)], sides(PATH, 'const before = 1;\n', 'const after = 2;\n'));
    }

    it('asks the answerable rule alone and still reports the rule it could not ask', async () => {
        const asked: string[][] = [];
        const provider: SemanticProviderPort = {
            systemOne: async ({ questions }) => {
                asked.push(Object.keys(questions));
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        };
        const { report, storedResponses } = await runScan(scanInput({ provider, source: mixedSource() }));
        // The unit's rules are exactly these two, and only the second one's evidence is carried.
        const stored = storedResponses[0];
        expect(stored?.ruleIds).toEqual(['public_contract_widened_silently', 'forbidden_dependency_direction']);
        expect(asked).toEqual([['forbidden_dependency_direction']]);
        expect(stored?.passes.map((pass) => pass.answerRuleIds)).toEqual([['forbidden_dependency_direction']]);
        expect(Object.keys(stored?.answers ?? {})).toEqual(['forbidden_dependency_direction']);
        // The unasked rule is not missing from the report: it reports the evidence its request lacked.
        const unsupported = report.signals.find((signal) => signal.ruleId === 'public_contract_widened_silently');
        expect(unsupported?.outcome).toBe('insufficient_context');
        expect(unsupported?.missingEvidence).toEqual(['caller or contract']);
        expect(stored?.missingEvidence.public_contract_widened_silently).toEqual(['caller or contract']);
        const supported = report.signals.find((signal) => signal.ruleId === 'forbidden_dependency_direction');
        expect(supported?.outcome).toBe('no_signal');
        expect(supported?.missingEvidence).toEqual([]);
        expect(report.scope.assessed).toBe(1);
        expect(report.usage.networkAttempts).toBe(1);
    });

    it('refuses a response that omits the answer to a question its request sent', async () => {
        const provider: SemanticProviderPort = {
            systemOne: async () => ({
                model: TYPESAFE_MODEL,
                answers: {},
                usage: { input_tokens: 1, output_tokens: 0 },
            }),
        };
        const { report } = await runScan(scanInput({ provider, source: mixedSource() }));
        expect(report.scope.assessed).toBe(0);
        expect(report.failureCode).toBe('invalid_response');
        expect(unassessedOf(report)).toEqual([{ path: PATH, reason: 'invalid_response', priorityClass: 'production' }]);
    });

    it('refuses an answer to a question its request never sent', async () => {
        const unsentRule = 'stated_invariant_contradicted';
        const provider: SemanticProviderPort = {
            systemOne: async ({ questions }) => {
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.05 };
                }
                answers[unsentRule] = { type: 'noul', noul: 0.95 };
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 1, output_tokens: 0 } };
            },
        };
        const path = 'src/modules/AudioEngine/live.ts';
        const { report } = await runScan(
            scanInput({
                provider,
                source: fakeSource([changedFile(path)], sides(path, 'const a = 1;\n', 'const a = 2;\n')),
            })
        );
        // The rule is applicable to the path but unanswerable, so it is not in the questions the request
        // sent; an answer for it is refused rather than merged.
        expect(report.failureCode).toBe('invalid_response');
        expect(report.scope.assessed).toBe(0);
        expect(unassessedOf(report)).toEqual([
            { path, reason: 'invalid_response', priorityClass: 'severe-production' },
        ]);
    });
});

describe('response caching follows the question membership', () => {
    const PATH = 'src/infra/thing.ts';

    it('does not reuse an answer cached for the unit rules a request no longer asks', async () => {
        const files = [changedFile(PATH)];
        const source = fakeSource(files, sides(PATH, 'const before = 1;\n', 'const after = 2;\n'));
        const set = collectFrom(source);
        const unit = plannedUnit(files, set);
        const pass = unit.evidence.passes[0];
        if (pass === undefined) {
            throw new Error('the fixture composed no pass, so the case would assert nothing');
        }
        const asked = answerableRulesForPass({
            rules: unit.rules,
            pass,
            kind: unit.file.kind,
            evidence: unit.evidence,
        });
        const payloadFor = (rules: typeof unit.rules) =>
            passRequestPayload({ unitId: unit.unitId, path: unit.path, file: unit.file, rules, pass });
        const askedPayload = payloadFor(asked);
        const wholePayload = payloadFor(unit.rules);
        // The question sets differ, so the identities must: an answer bought for one membership cannot
        // be handed to another.
        expect(asked).toHaveLength(1);
        expect(askedPayload.state).toEqual(wholePayload.state);
        expect(computeResponseCacheKey({ ...askedPayload, model: TYPESAFE_MODEL })).not.toBe(
            computeResponseCacheKey({ ...wholePayload, model: TYPESAFE_MODEL })
        );

        // A cache entry written for the whole question set — what an older run stored — must be a miss
        // for the request this run sends, and the provider must be asked again.
        const cache = new MapCache();
        const answers: Record<string, unknown> = {};
        for (const rule of unit.rules) {
            answers[rule.id] = { type: 'noul', noul: 0.9 };
        }
        cache.write(computeResponseCacheKey({ ...wholePayload, model: TYPESAFE_MODEL }), {
            model: TYPESAFE_MODEL,
            answers,
            usage: { input_tokens: 5, output_tokens: 0 },
        });
        const provider = countingProvider();
        const { report } = await runScan(scanInput({ provider: provider.port, source, cache }));
        expect(provider.calls()).toBe(1);
        expect(report.scope.cacheHits).toBe(0);
        expect(report.scope.assessed).toBe(1);
        // The cached 0.9 is nowhere in the report: the stale membership's answer was not merged.
        expect(report.signals.some((signal) => signal.probability === 0.9)).toBe(false);
    });

    it('reuses an answer only for the exact questions and evidence it was written for', async () => {
        const source = fakeSource([changedFile(PATH)], sides(PATH, 'const before = 1;\n', 'const after = 2;\n'));
        const cache = new MapCache();
        const provider = countingProvider();
        const first = await runScan(scanInput({ provider: provider.port, source, cache }));
        expect(first.report.scope.cacheHits).toBe(0);
        const second = await runScan(scanInput({ provider: provider.port, source, cache }));
        expect(provider.calls()).toBe(1);
        expect(second.report.scope.cacheHits).toBe(1);
        expect(second.report.usage.networkAttempts).toBe(0);
    });
});

const EXCLUDED_PATH = 'docs/README.md';
const SKIPPED_PATH = 'crates/daw-dsp/src/big.rs';
const FAILED_PATH = 'electron/a-timeout.ts';
const STARVED_PATH = 'electron/b-budget.ts';

/** The four-state fixture: an excluded path, a skipped unit, a failed unit, and a starved unit. */
function stateSource(): SemanticSourcePort {
    return fakeSource(
        [
            changedFile(EXCLUDED_PATH),
            changedFile(SKIPPED_PATH, { added: 900, deleted: 1 }),
            changedFile(FAILED_PATH),
            changedFile(STARVED_PATH),
        ],
        {
            ...sides(EXCLUDED_PATH, '# before\n', '# after\n'),
            ...sides(SKIPPED_PATH, 'const before = 1;\n', 'const sample_value = 1;\n'.repeat(900)),
            ...sides(FAILED_PATH, 'const a = 1;\n', 'const a = 2;\n'),
            ...sides(STARVED_PATH, 'const b = 1;\n', 'const b = 2;\n'),
        }
    );
}

/** A provider that times out on the fixture's failed unit and answers everything else quietly. */
function stateProvider(): SemanticProviderPort {
    return {
        systemOne: async ({ state, questions }) => {
            if (JSON.stringify(state).includes(FAILED_PATH)) {
                throw new APITimeoutError(SEMANTIC_BUDGET_PROFILES.local.attemptTimeoutMs);
            }
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                answers[key] = { type: 'noul', noul: 0.05 };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
        },
    };
}

/** One scan of the four-state fixture: a spent attempt, a failed request, and a starved unit. */
async function scannedFourStates() {
    const { report } = await runScan(
        scanInput({
            provider: stateProvider(),
            source: stateSource(),
            // One attempt: the failed unit spends it, and the unit behind it is never admitted.
            profile: { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1 },
        })
    );
    expect(() => validateReport(report)).not.toThrow();
    return report;
}

describe('the run totals keep the four omission states apart', () => {
    it('counts exclusion, missing evidence, a provider failure, and a spent budget separately', async () => {
        const report = await scannedFourStates();
        // The plan's order is what makes the four states reachable in one run: the severe unit asks
        // nothing, the timeout unit spends the attempt, and the last unit is starved behind it.
        expect((report.scope.requestOrder ?? []).map((entry) => entry.path)).toEqual([
            SKIPPED_PATH,
            FAILED_PATH,
            STARVED_PATH,
        ]);
        expect(unassessedOf(report)).toEqual([
            { path: SKIPPED_PATH, reason: 'missing-required-evidence', priorityClass: 'severe-production' },
            { path: FAILED_PATH, reason: 'timeout', priorityClass: 'production' },
            { path: STARVED_PATH, reason: 'budget_exhausted', priorityClass: 'production' },
        ]);
        expect(report.scope.excluded).toEqual([{ path: EXCLUDED_PATH, reason: 'no-applicable-rule' }]);
        expect(report.scope.states).toEqual({
            notApplicable: 1,
            excludedWithAssessmentOwed: 0,
            missingRequiredEvidence: 1,
            omittedForBudgetOrDeadline: 1,
            providerFailure: 1,
            dryRun: 0,
        });
        // The run-level code is the last stop that ended admission; each unit's own reason above keeps
        // the cause that applied to it, which is what the totals read.
        expect(report.failureCode).toBe('budget_exhausted');
    });

    it('refuses totals whose buckets disagree with the entries although their sums balance', async () => {
        // A swapped bucket leaves the sums intact: one unit read as a provider failure while the entry
        // behind it names a spent budget. The totals are compared field by field, so it is refused.
        const report = await scannedFourStates();
        const states = report.scope.states;
        expect(states).toBeDefined();
        if (states === undefined) {
            throw new Error('the run published no totals, so the case would assert nothing');
        }
        expect(states.providerFailure).toBeGreaterThan(0);
        expect(() =>
            validateReport({
                ...report,
                scope: {
                    ...report.scope,
                    states: {
                        ...states,
                        providerFailure: states.providerFailure - 1,
                        omittedForBudgetOrDeadline: states.omittedForBudgetOrDeadline + 1,
                    },
                },
            })
        ).toThrow(/omittedForBudgetOrDeadline state/);
    });
});

describe('a stored report cannot publish a plan its own records refute', () => {
    it('refuses a reversed planned order', async () => {
        const report = await scannedFourStates();
        const order = report.scope.requestOrder ?? [];
        expect(order.length).toBeGreaterThan(1);
        expect(() =>
            validateReport({ ...report, scope: { ...report.scope, requestOrder: [...order].reverse() } })
        ).toThrow(/admission key orders the other way/);
    });

    it('refuses an order that drops an entry', async () => {
        const report = await scannedFourStates();
        const order = report.scope.requestOrder ?? [];
        expect(order.length).toBeGreaterThan(1);
        expect(() => validateReport({ ...report, scope: { ...report.scope, requestOrder: order.slice(1) } })).toThrow(
            /planned unit\(s\) for 3 eligible/
        );
    });

    it('refuses an entry naming a path the scope recorded as excluded', async () => {
        // The enforceable form of "never planned": the report's own excluded list says this path owed no
        // plan, so an order entry naming it describes a walk the planner never took.
        const report = await scannedFourStates();
        const order = report.scope.requestOrder ?? [];
        expect(report.scope.excluded.map((entry) => entry.path)).toEqual([EXCLUDED_PATH]);
        const doctored = order.map((entry, index) => (index === 0 ? { ...entry, path: EXCLUDED_PATH } : entry));
        expect(() => validateReport({ ...report, scope: { ...report.scope, requestOrder: doctored } })).toThrow(
            /never planned it/
        );
    });

    it('refuses an entry renamed to a path no signal of the report names', async () => {
        // The general form: a path the report records nowhere, on a unit whose ledger the doctored entry
        // still carries. Length, distinctness, the excluded list and the unassessed list all still agree,
        // so only the agreement between the order and the report's own signals refutes it.
        const path = 'src/infra/thing.ts';
        const provider = countingProvider();
        const { report } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource([changedFile(path)], sides(path, 'const before = 1;\n', 'const after = 2;\n')),
            })
        );
        expect(() => validateReport(report)).not.toThrow();
        const entry = (report.scope.requestOrder ?? [])[0];
        if (entry === undefined) {
            throw new Error('the run published no planned entry, so the case would assert nothing');
        }
        expect(report.signals.some((signal) => signal.path === entry.path)).toBe(true);
        // The refusal names the unit whose ledger the order no longer lists: the signal's own path.
        expect(() =>
            validateReport({
                ...report,
                scope: { ...report.scope, requestOrder: [{ ...entry, path: 'nope/never-planned.ts' }] },
            })
        ).toThrow(/carries a signal for src\/infra\/thing.ts, which its planned order does not list/);
    });

    it('refuses an entry fabricated for a unit the report records no trace of', async () => {
        // The count tie and the scope arithmetic both still hold here: the fabricated entry is appended
        // and the eligible, assessed, and discovered counts are raised with it, so the order is as long
        // as the eligible count and stays sorted by the key. Only the ledger tie refutes it — nothing in
        // the report's own signals or unassessed entries names that unit.
        const report = await scannedFourStates();
        const order = report.scope.requestOrder ?? [];
        const last = order[order.length - 1];
        if (last === undefined) {
            throw new Error('the run published no planned entry, so the case would assert nothing');
        }
        const fabricated = { ...last, path: 'nope/fabricated.ts' };
        expect(report.signals.some((signal) => signal.path === fabricated.path)).toBe(false);
        expect(report.scope.unassessed.some((entry) => entry.path === fabricated.path)).toBe(false);
        expect(() =>
            validateReport({
                ...report,
                scope: {
                    ...report.scope,
                    discovered: report.scope.discovered + 1,
                    eligible: report.scope.eligible + 1,
                    assessed: report.scope.assessed + 1,
                    requestOrder: [...order, fabricated],
                },
            })
        ).toThrow(/neither a signal nor an unassessed entry names it/);
    });

    it('refuses a verify report that carries a planned order', async () => {
        // A verifier walks findings, never units, so an order beside its findings is a claim its mode
        // cannot produce and no ledger of its own can corroborate.
        const report = await scannedFourStates();
        expect(() => validateReport({ ...report, mode: 'verify', findingAssessments: [] })).toThrow(
            /only a scan produces/
        );
    });

    it('accepts the order the run itself published', async () => {
        const report = await scannedFourStates();
        expect(report.scope.requestOrder).toHaveLength(report.scope.eligible);
        expect(() => validateReport(report)).not.toThrow();
    });
});

describe('the dry-run manifest and the replayed ledger', () => {
    it('keeps every eligible unit unassessed under a dry-run reason, with the order published', async () => {
        const path = 'src/modules/AudioEngine/live.ts';
        const provider = forbiddenProvider();
        const input = scanInput({
            provider: provider.port,
            source: fakeSource([changedFile(path)], sides(path, 'const a = 1;\n', 'const a = 2;\n')),
        });
        const { report, previews } = await runScan({ ...input, dryRun: true });
        expect(provider.calls()).toBe(0);
        expect(report.execution).toBe('skipped');
        expect(report.scope.eligible).toBe(1);
        expect(report.scope.assessed).toBe(0);
        expect(unassessedOf(report)).toEqual([
            { path, reason: 'dry-run-made-no-request', priorityClass: 'severe-production' },
        ]);
        expect(report.scope.states?.dryRun).toBe(1);
        expect(report.scope.requestOrder?.map((entry) => entry.path)).toEqual([path]);
        expect(previews).toHaveLength(1);
        expect(() => validateReport(report)).not.toThrow();
    });

    it('replays a called unit and a skipped unit to the ledger the scan reported', async () => {
        const calledPath = 'src/infra/thing.ts';
        const skippedPath = 'crates/daw-dsp/src/big.rs';
        const provider = countingProvider();
        const { report, storedResponses } = await runScan(
            scanInput({
                provider: provider.port,
                source: fakeSource([changedFile(skippedPath, { added: 900, deleted: 1 }), changedFile(calledPath)], {
                    ...sides(skippedPath, 'const before = 1;\n', 'const sample_value = 1;\n'.repeat(900)),
                    ...sides(calledPath, 'const before = 1;\n', 'const after = 2;\n'),
                }),
            })
        );
        expect(provider.calls()).toBe(1);
        // The sidecar shape the command writes and reads back, byte for byte.
        const sidecar = JSON.stringify({
            contextDigest: report.context.contextDigest,
            rulesDigest: report.rulesDigest,
            units: storedResponses,
        });
        const parsed = parseStoredResponses(JSON.parse(sidecar) as unknown, 'responses.json');
        const replayed = replayScanSignals(parsed);
        expect(replayed).toEqual(report.signals);
        // The skipped unit contributes its whole ledger, not nothing: a replay that dropped it would
        // read as a more complete run than the scan was.
        const skippedRules = storedResponses.find((unit) => unit.path === skippedPath)?.ruleIds ?? [];
        expect(skippedRules.length).toBeGreaterThan(1);
        for (const ruleId of skippedRules) {
            const signal = replayed.find((entry) => entry.path === skippedPath && entry.ruleId === ruleId);
            expect(signal?.outcome).toBe('insufficient_context');
        }
        // The called unit keeps its decisive answer and its unasked rule's missing evidence.
        expect(
            replayed.find((entry) => entry.path === calledPath && entry.ruleId === 'forbidden_dependency_direction')
                ?.outcome
        ).toBe('no_signal');
        expect(
            replayed.find((entry) => entry.path === calledPath && entry.ruleId === 'public_contract_widened_silently')
                ?.outcome
        ).toBe('insufficient_context');
    });
});

describe('the merged answer comes only from a pass that asked', () => {
    const PATH = 'src/infra/thing.ts';

    /** The fixture's one unit, its one pass, and the rules that pass can answer. */
    function fixture() {
        const files = [changedFile(PATH)];
        const source = fakeSource(files, sides(PATH, 'const before = 1;\n', 'const after = 2;\n'));
        const unit = plannedUnit(files, collectFrom(source));
        const pass = unit.evidence.passes[0];
        if (pass === undefined) {
            throw new Error('the fixture composed no pass, so the case would assert nothing');
        }
        const asked = answerableRulesForPass({
            rules: unit.rules,
            pass,
            kind: unit.file.kind,
            evidence: unit.evidence,
        });
        const assessedPass = (answers: Record<string, unknown>, askedRuleIds: readonly string[]) => ({
            pass,
            askedRuleIds: askedRuleIds as readonly SemanticRuleId[],
            result: {
                cacheKey: 'fixture',
                response: { model: TYPESAFE_MODEL, answers },
                attempts: [],
                fromCache: false,
                requestedModel: TYPESAFE_MODEL,
            },
        });
        return { unit, pass, asked, assessedPass };
    }

    it('merges the asked rule from its pass and reports the rule no pass asked as missing', () => {
        const { unit, asked, assessedPass } = fixture();
        const answer = { type: 'noul', noul: 0.9 };
        const merged = mergeUnitAnswers({
            unit,
            assessedPasses: [
                assessedPass(
                    { forbidden_dependency_direction: answer },
                    asked.map((rule) => rule.id)
                ),
            ],
        });
        expect(merged.stored.answers).toEqual({ forbidden_dependency_direction: answer });
        expect(merged.signals.find((signal) => signal.ruleId === 'forbidden_dependency_direction')?.outcome).toBe(
            'signal'
        );
        const unasked = merged.signals.find((signal) => signal.ruleId === 'public_contract_widened_silently');
        expect(unasked?.outcome).toBe('insufficient_context');
        expect(unasked?.missingEvidence).toEqual(['caller or contract']);
        expect(merged.stored.passes.map((pass) => pass.answerRuleIds)).toEqual([['forbidden_dependency_direction']]);
        expect(merged.stored.omissionReason).toBeUndefined();
    });

    it('refuses to merge a rule whose evidence a pass carried but whose request never asked it', () => {
        // The membership gate: the pass held every side the rule needs, so a dropped question is a
        // defect in the request, not evidence the unit never had. Merging it silently would report a
        // decisive answer for a question nothing asked.
        const { unit, assessedPass } = fixture();
        expect(() =>
            mergeUnitAnswers({
                unit,
                assessedPasses: [assessedPass({ forbidden_dependency_direction: { type: 'noul', noul: 0.9 } }, [])],
            })
        ).toThrow(/never asked/);
    });

    it('reports every rule of a unit as missing evidence when no pass can ask one', () => {
        // A unit no pass can ask is the only unit whose merge may run with no assessed pass at all; for
        // an answerable rule that state is a defect the merge refuses, which the case above reads.
        const skippedPath = 'crates/daw-dsp/src/big.rs';
        const files = [changedFile(skippedPath, { added: 900, deleted: 1 })];
        const source = fakeSource(
            files,
            sides(skippedPath, 'const before = 1;\n', 'const sample_value = 1;\n'.repeat(900))
        );
        const unit = plannedUnit(files, collectFrom(source));
        const merged = mergeUnitAnswers({ unit, assessedPasses: [] });
        expect(merged.stored.answers).toEqual({});
        expect(merged.stored.passes).toEqual([]);
        expect(merged.stored.omissionReason).toBe('missing-required-evidence');
        expect(merged.fromCache).toBe(false);
        expect(merged.signals.map((signal) => signal.outcome)).toEqual(
            merged.signals.map(() => 'insufficient_context')
        );
        expect(merged.signals.every((signal) => signal.missingEvidence.length > 0)).toBe(true);
    });
});
