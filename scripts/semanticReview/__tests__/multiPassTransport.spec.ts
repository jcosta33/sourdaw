import { describe, expect, it } from 'vitest';

import {
    semanticTextDigest,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticRevisionBase,
} from '../contracts.ts';
import { collectEvidence, type PathHunks, type SemanticChangedFile, type SemanticSourcePort } from '../evidence.ts';
import { choosePassIndexForRule } from '../passes.ts';
import {
    assessUnit,
    computeResponseCacheKey,
    createBudgetController,
    TYPESAFE_MODEL,
    type SemanticProviderPort,
} from '../provider.ts';
import { SEMANTIC_BUDGET_PROFILES, semanticRule } from '../rules.ts';
import { planUnits, runScan } from '../run.ts';

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

function changedFile(path: string, overrides: Partial<SemanticChangedFile> = {}): SemanticChangedFile {
    return { path, kind: 'modified', binary: false, generated: false, added: 3, deleted: 1, ...overrides };
}

function fakeSource(
    files: readonly SemanticChangedFile[],
    blobs: Readonly<Record<string, string>>,
    hunks?: ReadonlyMap<string, PathHunks>
): SemanticSourcePort {
    return {
        changedFiles: () => files,
        readFile: (sha, path) => blobs[`${sha}:${path}`],
        changedHunks: () => hunks ?? new Map<string, PathHunks>(),
    };
}

function fixedClock(start: number): { readonly now: () => number } {
    return { now: () => start };
}

function constantProvider(answer: number): SemanticProviderPort {
    return {
        systemOne: async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                answers[key] = { type: 'noul', noul: answer };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 100, output_tokens: 0 } };
        },
    };
}

class MapCache {
    readonly entries = new Map<string, unknown>();
    read = (key: string): unknown => this.entries.get(key);
    write = (key: string, value: unknown): void => {
        this.entries.set(key, value);
    };
}

function scanInput(
    provider: SemanticProviderPort,
    source: SemanticSourcePort,
    clock: { readonly now: () => number }
): Parameters<typeof runScan>[0] {
    return {
        ports: {
            source,
            provider,
            cache: new MapCache(),
            clock,
            signal: new AbortController().signal,
            log: () => undefined,
        },
        revision: BASE_REVISION,
        profile: SEMANTIC_BUDGET_PROFILES.local,
        limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        contractPaths: [],
        runId: 'multi-pass-test',
        dryRun: false,
    };
}

/**
 * The local evidence budget, but with an attempt and byte ceiling large enough for a unit split into
 * many passes. The per-request state budget is unchanged, so pass composition still comes from the
 * shipped numbers; only the run-level ceilings are lifted so the fixture's six-pass unit is assessed.
 */
const MULTI_PASS_PROFILE = {
    ...SEMANTIC_BUDGET_PROFILES.local,
    maxAttempts: 64,
    maxTotalSubmittedBytes: 4 * 1024 * 1024,
};

function reference(evidenceId: string, side: EvidenceSide, path = 'src/a.ts'): EvidenceReference {
    return {
        evidenceId,
        revisionSha: HEAD,
        path,
        side,
        startLine: 1,
        endLine: 1,
        contentHash: semanticTextDigest(evidenceId),
    };
}

/**
 * A modified test file whose after side is `count` single-line hunks. The after side is deliberately
 * large enough to exceed one request, so the unit's own regions split into more than one pass while
 * every region stays under the per-region ceiling and therefore travels.
 */
function bigHunkedTestFile(
    count: number,
    width: number
): {
    readonly file: SemanticChangedFile;
    readonly before: string;
    readonly after: string;
    readonly hunks: PathHunks;
} {
    const path = 'src/modules/Project/__tests__/big.spec.ts';
    const rows = Array.from(
        { length: count },
        (_unused, index) => `export const value${String(index)} = '${'x'.repeat(width)}';\n`
    );
    return {
        file: changedFile(path, { added: count, deleted: 1 }),
        before: 'it("before", () => {});\n',
        after: rows.join(''),
        hunks: {
            path,
            before: [{ startLine: 1, endLine: 1 }],
            after: rows.map((_row, index) => ({ startLine: index + 1, endLine: index + 1 })),
        },
    };
}

describe('multi-pass evidence transport', () => {
    it('partitions a unit that exceeds one request deterministically, carrying every region', () => {
        const fixture = bigHunkedTestFile(80, 160);
        const files = [fixture.file];
        const set = collectEvidence({
            port: fakeSource(
                files,
                {
                    [`${MERGE_BASE}:${fixture.file.path}`]: fixture.before,
                    [`${HEAD}:${fixture.file.path}`]: fixture.after,
                },
                new Map([[fixture.file.path, fixture.hunks]])
            ),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const own = set.references.filter((region) => region.path === fixture.file.path);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        expect(unit?.evidence.passes.length).toBeGreaterThanOrEqual(2);
        // Every minted region is carried by exactly one pass; none is dropped for the budget.
        const carried = new Set(
            unit?.evidence.passes.flatMap((pass) => pass.references.map((region) => region.evidenceId))
        );
        expect(carried.size).toBe(own.length);
        expect([...carried].sort()).toEqual(own.map((region) => region.evidenceId).sort());
        // Determinism: the same unit and profile produce the same pass ids every time.
        const again = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes).units[0];
        expect(again?.evidence.passes.map((pass) => pass.passId)).toEqual(
            unit?.evidence.passes.map((pass) => pass.passId)
        );
        // Each pass is a subset, in order, of the whole region set.
        expect(unit?.evidence.passes.flatMap((pass) => pass.references).length).toBe(own.length);
    });

    it('assesses a unit with all of it: no missing evidence and the stored record names its passes', async () => {
        const fixture = bigHunkedTestFile(80, 160);
        const result = await runScan({
            ...scanInput(
                constantProvider(0.05),
                fakeSource(
                    [fixture.file],
                    {
                        [`${MERGE_BASE}:${fixture.file.path}`]: fixture.before,
                        [`${HEAD}:${fixture.file.path}`]: fixture.after,
                    },
                    new Map([[fixture.file.path, fixture.hunks]])
                ),
                fixedClock(1_000)
            ),
            profile: MULTI_PASS_PROFILE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(result.report.scope.assessed).toBe(1);
        const stored = result.storedResponses[0];
        expect(stored).toBeDefined();
        expect(stored?.passes.length).toBeGreaterThanOrEqual(2);
        // No question reports the unit's own before/after test source missing: every own region was
        // carried across the passes, so no own-side token is unsupplied for want of a region.
        for (const ruleId of stored?.ruleIds ?? []) {
            const missing = stored?.missingEvidence[ruleId] ?? [];
            expect(missing).not.toContain('before test source');
            expect(missing).not.toContain('after test source');
        }
        expect(stored?.missingEvidence.assertion_deleted ?? []).toEqual([]);
        // Nothing was truncated for want of a region.
        expect(result.report.scope.truncated.some((entry) => entry.reason.startsWith('unit-evidence-'))).toBe(false);
    });

    it('binds the response cache to the pass composition', async () => {
        const questions = { r: { type: 'noul', instructions: 'x' } };
        const stateA = {
            unit: { unitId: 'p', path: 'src/a.ts', changeKind: 'modified' },
            evidence: { a1: { path: 'src/a.ts', side: 'after', content: 'one' } },
        };
        const stateB = {
            unit: { unitId: 'p', path: 'src/a.ts', changeKind: 'modified' },
            evidence: { a2: { path: 'src/a.ts', side: 'after', content: 'two' } },
        };
        const keyA = computeResponseCacheKey({ state: stateA, questions, model: TYPESAFE_MODEL });
        const keyB = computeResponseCacheKey({ state: stateB, questions, model: TYPESAFE_MODEL });
        expect(keyA).not.toBe(keyB);

        let calls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                calls += 1;
                return { model: TYPESAFE_MODEL, answers: {}, usage: { input_tokens: 1, output_tokens: 0 } };
            },
        };
        const cache = new MapCache();
        const budget = createBudgetController(SEMANTIC_BUDGET_PROFILES.local);
        const base = {
            port: provider,
            cache,
            budget,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            deadline: Date.now() + 10_000,
            questions,
            requestedModel: TYPESAFE_MODEL,
            signal: new AbortController().signal,
        };
        const first = await assessUnit({ ...base, state: stateA });
        expect(first.fromCache).toBe(false);
        // Identical composition is a cache hit.
        const second = await assessUnit({ ...base, state: stateA });
        expect(second.fromCache).toBe(true);
        expect(calls).toBe(1);
        // A different pass composition misses and calls the provider.
        const third = await assessUnit({ ...base, state: stateB });
        expect(third.fromCache).toBe(false);
        expect(calls).toBe(2);
    });

    it('accounts per pass and names a region no pass could carry', async () => {
        const path = 'crates/daw-dsp/src/big.rs';
        // The after side is large enough to exceed one request on its own, so no pass carries it: it is
        // dropped whole and its side recorded. The before side fits and travels in pass one.
        const before = 'const before = 1;\n';
        const after = 'const sample_value = 1;\n'.repeat(900);
        const result = await runScan({
            ...scanInput(
                constantProvider(0.05),
                fakeSource(
                    [changedFile(path, { added: 900, deleted: 1 })],
                    { [`${MERGE_BASE}:${path}`]: before, [`${HEAD}:${path}`]: after },
                    new Map<string, PathHunks>()
                ),
                fixedClock(1_000)
            ),
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(result.report.scope.assessed).toBe(1);
        expect(result.report.usage.networkAttempts).toBe(1);
        // The region no pass carried is named with its side.
        expect(result.report.scope.truncated).toContainEqual({
            path,
            reason: 'unit-evidence-reduced-below-request-budget (after)',
        });
    });

    it('counts one network attempt and one byte reservation per pass sent', async () => {
        const fixture = bigHunkedTestFile(80, 160);
        const result = await runScan({
            ...scanInput(
                constantProvider(0.05),
                fakeSource(
                    [fixture.file],
                    {
                        [`${MERGE_BASE}:${fixture.file.path}`]: fixture.before,
                        [`${HEAD}:${fixture.file.path}`]: fixture.after,
                    },
                    new Map([[fixture.file.path, fixture.hunks]])
                ),
                fixedClock(1_000)
            ),
            profile: MULTI_PASS_PROFILE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const passes = result.storedResponses[0]?.passes.length ?? 0;
        expect(passes).toBeGreaterThanOrEqual(2);
        // local profile retries zero times, so each pass is exactly one network attempt.
        expect(result.report.usage.networkAttempts).toBe(passes);
        // The bytes submitted exceed one request's state budget, so the evidence travelled in several
        // requests rather than being trimmed to one.
        expect(result.report.usage.submittedBytes).toBeGreaterThan(
            SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes
        );
    });

    it('leaves a unit unassessed when a later pass is refused, instead of merging a partial answer', async () => {
        const fixture = bigHunkedTestFile(80, 160);
        const profile = { ...SEMANTIC_BUDGET_PROFILES.local, maxAttempts: 1, maxRetriesPerRequest: 0 };
        const result = await runScan({
            ...scanInput(
                constantProvider(0.05),
                fakeSource(
                    [fixture.file],
                    {
                        [`${MERGE_BASE}:${fixture.file.path}`]: fixture.before,
                        [`${HEAD}:${fixture.file.path}`]: fixture.after,
                    },
                    new Map([[fixture.file.path, fixture.hunks]])
                ),
                fixedClock(1_000)
            ),
            profile,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        // All-or-nothing: the first pass succeeded, but the second was refused, so no partial merged
        // answer is recorded for the unit.
        expect(result.report.scope.assessed).toBe(0);
        expect(result.storedResponses).toHaveLength(0);
        expect(result.report.failureCode).toBe('budget_exhausted');
        expect(result.report.usage.networkAttempts).toBe(1);
        expect(result.report.scope.unassessed).toEqual([{ path: fixture.file.path, reason: 'budget_exhausted' }]);
    });
});

describe('merge rule', () => {
    it('picks the earliest pass that carries the required evidence', () => {
        // For an added test file, `assertion_deleted` requires only the after test source, so two passes
        // that each carry an after region both supply it. The tie is broken by the earliest pass.
        const rule = semanticRule('assertion_deleted');
        const passes = [
            { own: [reference('a1', 'after')], context: [] },
            { own: [reference('a2', 'after')], context: [] },
        ];
        expect(choosePassIndexForRule({ kind: 'added', rule, passes })).toBe(0);
        // A pass without the required side loses to one that has it, whatever the order.
        expect(
            choosePassIndexForRule({
                kind: 'added',
                rule,
                passes: [
                    { own: [reference('b1', 'before')], context: [] },
                    { own: [reference('a2', 'after')], context: [] },
                ],
            })
        ).toBe(1);
    });
});
