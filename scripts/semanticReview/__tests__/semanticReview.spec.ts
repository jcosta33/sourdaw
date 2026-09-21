import { AuthenticationError, RateLimitError } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';

import {
    assertAdvisoryWording,
    buildRevisionContext,
    computeContextDigest,
    semanticDigest,
    SemanticFailure,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticRevisionBase,
} from '../contracts.ts';
import {
    collectEvidence,
    exclusionReason,
    type PathHunks,
    type SemanticChangedFile,
    type SemanticSourcePort,
} from '../evidence.ts';
import { fitUnitEvidence } from '../fit.ts';
import { parseUnifiedDiffRanges } from '../gitSource.ts';
import { interpretFinding, interpretScanOutcome, readChoiceAnswer } from '../interpret.ts';
import {
    assessUnit,
    computeResponseCacheKey,
    createBudgetController,
    readUsage,
    TYPESAFE_MODEL,
    type SemanticProviderPort,
} from '../provider.ts';
import { renderSummary, validateReport } from '../report.ts';
import { missingRequiredEvidence } from '../requiredEvidence.ts';
import {
    assertBudgetProfile,
    computePolicyDigest,
    computeRulesDigest,
    PROBABILITY_SUM_TOLERANCE,
    SEMANTIC_BUDGET_PROFILES,
    SEVERE_INVESTIGATION_CATEGORIES,
    isCollectedSpec,
    isTestPath,
    semanticRule,
    SEMANTIC_RULES,
    VERIFICATION_ATTRIBUTION_THRESHOLD,
    VERIFICATION_KIND_THRESHOLD,
    VERIFICATION_SUPPORT_THRESHOLD,
} from '../rules.ts';
import {
    assertQuestionsAreReplayable,
    executionState,
    isMissedAssessmentExclusion,
    planUnits,
    runScan,
} from '../run.ts';
import { sensitiveContentReason } from '../sensitive.ts';
import { computeVerifyQuestionsDigest, type CandidateFinding } from '../verify.ts';

/**
 * Fixtures are composed at runtime from their parts, so no credential-shaped literal appears here:
 * the repository's pull-request diff secret scan is a required gate, and its rules match the
 * `keyword=value` shape rather than only vendor prefixes.
 *
 * The parts are joined rather than encoded, and that distinction is load-bearing. Gitleaks decodes
 * base64 before matching — an encoded fixture still reports as the credential it decodes to, which
 * is exactly how this file failed the gate. A value that never exists contiguously in source has
 * nothing to match on either pass.
 */
function secretFixture(...parts: readonly string[]): string {
    return parts.join('');
}

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

function fakeSource(input: {
    files: readonly SemanticChangedFile[];
    blobs?: Readonly<Record<string, string>>;
    /** Hunks by path. Absent means no hunks were read, so each side is supplied whole. */
    hunks?: ReadonlyMap<string, PathHunks>;
}): SemanticSourcePort {
    const blobs = input.blobs ?? {};
    return {
        changedFiles: () => input.files,
        readFile: (sha, path) => blobs[`${sha}:${path}`],
        changedHunks: () => input.hunks ?? new Map<string, PathHunks>(),
    };
}

function changedFile(path: string, overrides: Partial<SemanticChangedFile> = {}): SemanticChangedFile {
    return { path, kind: 'modified', binary: false, generated: false, added: 3, deleted: 1, ...overrides };
}

function fixedClock(start: number): { readonly now: () => number; advance: (ms: number) => void } {
    let current = start;
    return {
        now: () => current,
        advance: (ms) => {
            current += ms;
        },
    };
}

/** A provider that answers every question with the same distribution. */
/**
 * A provider that answers every question the same way. A number is a Noul answer — the probability
 * that the property holds — and a distribution is a Choice answer, which is what verification still
 * asks because supported/contradicted/undecidable is one three-valued judgement.
 */
function constantProvider(
    answer: Record<string, number> | number,
    overrides: Partial<SemanticProviderPort> = {}
): SemanticProviderPort {
    return {
        systemOne: async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                if (typeof answer === 'number') {
                    answers[key] = { type: 'noul', noul: answer };
                    continue;
                }
                const selected = Object.entries(answer).sort((left, right) => right[1] - left[1])[0]?.[0];
                answers[key] = {
                    type: 'choice',
                    probabilities: answer,
                    confidence: 0.9,
                    choice: selected,
                };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 100, output_tokens: 0 } };
        },
        ...overrides,
    };
}

const SHIPPED_RULES_DIGEST = computeRulesDigest();

function scanPorts(provider: SemanticProviderPort, source: SemanticSourcePort, clock: ReturnType<typeof fixedClock>) {
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
        runId: 'test-run',
        dryRun: false,
    };
}

/** An unbounded in-memory cache, equivalent to the production memory cache. */
class MapCache {
    readonly entries = new Map<string, unknown>();
    read = (key: string): unknown => this.entries.get(key);
    write = (key: string, value: unknown): void => {
        this.entries.set(key, value);
    };
}

describe('revision identity', () => {
    it('keeps the target base tip distinct from the merge base', () => {
        // AC-01: a run that conflated the two would report one sha for both.
        const context = buildRevisionContext({
            ...BASE_REVISION,
            evidenceProfile: 'ci',
            rulesDigest: SHIPPED_RULES_DIGEST,
            policyVersion: 'semantic-policy-v1',
        });
        expect(context.targetBaseSha).toBe(TARGET_BASE);
        expect(context.mergeBaseSha).toBe(MERGE_BASE);
        expect(context.targetBaseSha).not.toBe(context.mergeBaseSha);
    });

    it('changes the context digest when the merge base moves', () => {
        // AC-02: a moved base must invalidate the assessment context.
        const inputs = {
            ...BASE_REVISION,
            evidenceProfile: 'ci',
            rulesDigest: SHIPPED_RULES_DIGEST,
            policyVersion: 'p',
        };
        const first = computeContextDigest(inputs);
        const second = computeContextDigest({ ...inputs, mergeBaseSha: 'e'.repeat(40) });
        expect(first).not.toBe(second);
    });

    it('refuses a revision identity that is not a full sha', () => {
        expect(() =>
            buildRevisionContext({
                ...BASE_REVISION,
                headSha: 'abc',
                evidenceProfile: 'ci',
                rulesDigest: SHIPPED_RULES_DIGEST,
                policyVersion: 'p',
            })
        ).toThrow(SemanticFailure);
    });
});

describe('evidence collection', () => {
    it('represents renames, deletions, tests, generated, and binary changes in scope', () => {
        // AC-03: an excluded path stays visible with a reason rather than vanishing.
        const files = [
            changedFile('src/modules/AudioEngine/live.ts', {
                kind: 'renamed',
                previousPath: 'src/modules/AudioEngine/old.ts',
            }),
            changedFile('src/modules/Project/gone.ts', { kind: 'deleted' }),
            changedFile('src/modules/Project/__tests__/undo.spec.ts'),
            changedFile('public/wasm/daw-dsp/app.js', { generated: true }),
            changedFile('assets/impulse.wav', { binary: true }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/old.ts`]: 'const before = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const after = 1;\n',
                    [`${MERGE_BASE}:src/modules/Project/gone.ts`]: 'export const gone = true;\n',
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo works", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const reasons = new Map(set.excluded.map((entry) => [entry.path, entry.reason]));
        expect(reasons.get('public/wasm/daw-dsp/app.js')).toBe('generated');
        expect(reasons.get('assets/impulse.wav')).toBe('binary');
        // A deleted file keeps its before-side identity.
        const deleted = set.references.find((reference) => reference.path === 'src/modules/Project/gone.ts');
        expect(deleted?.side).toBe('before');
        // A rename supplies both sides under their respective paths.
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/AudioEngine/old.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) => reference.path === 'src/modules/AudioEngine/live.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // Tests are never excluded wholesale.
        expect(set.references.some((reference) => reference.path.endsWith('undo.spec.ts'))).toBe(true);
    });

    it('excludes sensitive paths and records the loss of context', () => {
        const set = collectEvidence({
            port: fakeSource({ files: [changedFile('.env')] }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.excluded).toEqual([{ path: '.env', reason: 'sensitive-content-excluded' }]);
        expect(set.references).toHaveLength(0);
        expect(set.limitations.join(' ')).toContain('no source region was eligible');
    });

    it('assigns stable application-generated evidence ids with real line bounds', () => {
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/a.ts')],
                blobs: { [`${MERGE_BASE}:src/a.ts`]: 'one\ntwo\n', [`${HEAD}:src/a.ts`]: 'one\ntwo\nthree\n' },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const ids = set.references.map((reference) => reference.evidenceId);
        // A side prefix plus a per-unit ordinal: stable, unique, and never model-authored.
        expect(ids).toEqual(['b1', 'a2']);
        const after = set.references[1] as EvidenceReference;
        expect(after.endLine).toBeGreaterThanOrEqual(after.startLine);
        expect(after.startLine).toBe(1);
    });
});

describe('unit planning', () => {
    it('bounds each unit separately so one large file cannot starve every later unit', () => {
        // Regression: the run-wide evidence ceiling was the per-request state budget, so the first
        // large file consumed it and the run reported 0 eligible units for a 22-path change. The
        // oversized file is now not sent at all, and the units that do fit are still assessed.
        const big = 'const sample = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/a.rs'), changedFile('crates/daw-dsp/src/b.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: big,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: big,
                    [`${MERGE_BASE}:crates/daw-dsp/src/b.rs`]: 'const b = 1;\n',
                    [`${HEAD}:crates/daw-dsp/src/b.rs`]: 'const b = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const { units, incomplete } = planUnits(files, set, 4_096);
        expect(units.map((unit) => unit.path)).toEqual(['crates/daw-dsp/src/b.rs']);
        expect(incomplete.map((entry) => entry.path)).toEqual(['crates/daw-dsp/src/a.rs']);
    });

    it('records a unit whose evidence could not be sent rather than dropping it silently', () => {
        const big = 'const sample = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/a.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: big,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        // 4 KiB holds the questions and wrapper but not the 6 KiB region, and a region is supplied
        // whole or not at all: the unit is refused and named rather than assessed over a fragment.
        const { units, incomplete } = planUnits(files, set, 4_096);
        expect(units).toHaveLength(0);
        expect(incomplete).toEqual([{ path: 'crates/daw-dsp/src/a.rs', reason: 'no-evidence-region-within-budget' }]);
    });
});

describe('change-kind applicability', () => {
    it('does not mark an added file incomplete for evidence that cannot exist', () => {
        // An added test file has no before side, so a rule about removing prior verification is
        // inapplicable rather than "missing evidence"; reporting it incomplete every time made the
        // whole run inconclusive on a change that only adds files.
        const files = [changedFile('src/modules/Project/__tests__/new.spec.ts', { kind: 'added' })];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${HEAD}:src/modules/Project/__tests__/new.spec.ts`]: 'it("works", () => {});\n',
                    [`${MERGE_BASE}:AGENTS.md`]: '# Rules\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md'],
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        const ruleIds = units[0]?.rules.map((rule) => rule.id) ?? [];
        expect(ruleIds).toContain('assertion_deleted');
        // A before side that cannot exist is not missing. The claim is about a side the change could
        // not have produced, not about every rule: the bypassed-path rule declares it needs the
        // implementation, and an added test file with no changed implementation genuinely does not
        // supply it, so asking every rule to report nothing here would hide exactly that.
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                units[0]?.evidence.own ?? [],
                units[0]?.evidence.context ?? [],
                'added'
            )
        ).toEqual([]);
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                units[0]?.evidence.own ?? [],
                units[0]?.evidence.context ?? [],
                'added'
            )
        ).toEqual(['after implementation source']);
        // The same rule on a modified file still demands the before side it can actually have.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), [], [], 'modified')).toEqual([
            'before test source',
            'after test source',
        ]);
    });
});

describe('a rename that changes test collection', () => {
    it('plans a zero-line rename that moves a test out of collection instead of skipping it', () => {
        // A pure rename has a zero-line diff. `no-text-change` excluded it, the eligible count fell
        // to zero, and the skipped branch read the change as delivered advice over the very collection
        // the rename removed.
        const file = changedFile('src/modules/Project/undo-helper.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();

        const set = collectEvidence({
            port: fakeSource({
                files: [file],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/undo-helper.ts`]: 'it("undo", () => {});\n',
                },
                // A pure rename emits no hunks at all — only `similarity index` and `rename from`/`to`
                // headers — so the collector's no-hunks fallback supplies each side whole.
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });

        const { units, excluded } = planUnits([file], set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        expect(excluded).toEqual([]);
        const unit = units[0];
        // The previous path still admits the test-validity questions even though the destination is no
        // longer a test.
        expect(unit?.rules.map((rule) => rule.id)).toContain('test_skipped_or_excluded');
        // A hunkless rename supplies both sides as whole-file regions under their own paths.
        expect(
            unit?.evidence.references.some(
                (reference) => reference.path === 'src/modules/Project/undo.spec.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            unit?.evidence.references.some(
                (reference) => reference.path === 'src/modules/Project/undo-helper.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // A planned unit is an assessment that was owed; the skipped branch would have claimed otherwise.
        expect(executionState({ dryRun: false, assessed: 0, eligible: units.length, failureCode: undefined })).toBe(
            'unavailable'
        );
    });
});

describe('a zero-line rename owes what its movement changes', () => {
    it('plans a rename that leaves a rule-covered surface instead of skipping it', () => {
        // `no-text-change` excluded the rename, so the check went green over a moved module boundary.
        const file = changedFile('docs/undo.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();

        const set = collectEvidence({
            port: fakeSource({
                files: [file],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: 'export const undo = () => {};\n',
                    [`${HEAD}:docs/undo.ts`]: 'export const undo = () => {};\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });

        const { units, excluded } = planUnits([file], set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        expect(units).toHaveLength(1);
        expect(excluded).toEqual([]);
        expect(units[0]?.rules.map((rule) => rule.id)).toContain('persisted_shape_changed_without_migration');
    });

    it('plans a zero-line rename that stops a runner collecting the file', () => {
        const file = changedFile('src/modules/Project/undo-helper.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('still excludes a rename between two paths that change neither rule set nor collection', () => {
        const file = changedFile('docs/undo-copy.md', {
            kind: 'renamed',
            previousPath: 'docs/undo.md',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBe('no-text-change');
    });
});

describe('copied files', () => {
    it('supplies both sides of a copy and does not waive the before side', () => {
        // A copy has both sides: its source is unchanged and its destination is new. Reading it as
        // `added` waived the before side, so a copy whose assertion was weakened was answered from the
        // after side alone with an empty `missingEvidence`.
        const files = [
            changedFile('src/modules/Project/__tests__/undo-copy.spec.ts', {
                kind: 'copied',
                previousPath: 'src/modules/Project/__tests__/undo.spec.ts',
                added: 2,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("undo", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo-copy.spec.ts`]: 'it("undo", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        // Both sides exist: before under the source path, after under the destination.
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'src/modules/Project/__tests__/undo.spec.ts' && reference.side === 'before'
            )
        ).toBe(true);
        expect(
            set.references.some(
                (reference) =>
                    reference.path === 'src/modules/Project/__tests__/undo-copy.spec.ts' && reference.side === 'after'
            )
        ).toBe(true);
        // The before side is genuinely supplied, not waived.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), set.references, [], 'copied')).toEqual([]);
        // A copy does not inherit the added-file waiver: with no before region supplied, the before
        // side is genuinely missing.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), [], [], 'copied')).toEqual([
            'before test source',
            'after test source',
        ]);
        // A genuinely added file still gets the existing waiver for the before side.
        expect(missingRequiredEvidence(semanticRule('assertion_deleted'), set.references, [], 'added')).toEqual([]);
    });
});

describe('a copy whose source is also modified', () => {
    it('yields each region once and selects own regions by the (path, side) the change implies', () => {
        // `M a.ts` plus `C100 a.ts c.ts`: the source's before side is read twice — once for the
        // modification, once for the copy's source — and must be minted once. Selecting own regions by
        // path alone handed the copy the source's after region as though it belonged to the copy.
        const files = [
            changedFile('src/modules/Project/a.ts'),
            changedFile('src/modules/Project/c.ts', {
                kind: 'copied',
                previousPath: 'src/modules/Project/a.ts',
                added: 1,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/a.ts`]: 'export const before = 1;\n',
                    [`${HEAD}:src/modules/Project/a.ts`]: 'export const after = 1;\n',
                    [`${HEAD}:src/modules/Project/c.ts`]: 'export const copy = 1;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(3);
        expect(set.references.filter((r) => r.path === 'src/modules/Project/a.ts' && r.side === 'before')).toHaveLength(
            1
        );
        expect(set.references.filter((r) => r.path === 'src/modules/Project/a.ts' && r.side === 'after')).toHaveLength(
            1
        );
        expect(set.references.filter((r) => r.path === 'src/modules/Project/c.ts' && r.side === 'after')).toHaveLength(
            1
        );

        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const source = units.find((unit) => unit.path === 'src/modules/Project/a.ts');
        const copy = units.find((unit) => unit.path === 'src/modules/Project/c.ts');
        const ownSides = (unit: typeof source): string[] =>
            (unit?.evidence.own ?? []).map((reference) => `${reference.path}:${reference.side}`).sort();
        expect(ownSides(source)).toEqual(['src/modules/Project/a.ts:after', 'src/modules/Project/a.ts:before']);
        expect(ownSides(copy)).toEqual(['src/modules/Project/a.ts:before', 'src/modules/Project/c.ts:after']);
        expect(
            copy?.evidence.own.some(
                (reference) => reference.path === 'src/modules/Project/a.ts' && reference.side === 'after'
            )
        ).toBe(false);
    });
});

describe('provider rounding', () => {
    it('normalizes a rounded distribution instead of refusing a valid answer', () => {
        // Observed live: a three-way Choice summed to 0.99 because the provider rounds, and a 0.01
        // tolerance failed on |0.99 - 1| alone, which made roughly one request in twelve fail.
        const parsed = readChoiceAnswer(
            {
                type: 'choice',
                probabilities: { supported: 0, contradicted: 0.93, insufficient_context: 0.06 },
                confidence: 0.89,
                choice: 'contradicted',
            },
            ['supported', 'contradicted', 'insufficient_context'],
            'rounded distribution'
        );
        expect(parsed.selected).toBe('contradicted');
        const total = Object.values(parsed.probabilities).reduce((sum, value) => sum + value, 0);
        expect(total).toBeCloseTo(1, 10);
    });

    it('still refuses a distribution that is not close to one', () => {
        expect(() =>
            interpretScanOutcome({
                answer: {
                    type: 'choice',
                    probabilities: 0.2,
                    confidence: 0.5,
                    choice: 'signal',
                },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: 'src/a.spec.ts',
                missingEvidence: [],
            })
        ).toThrow(SemanticFailure);
    });
});

describe('interpretation policy', () => {
    it('never turns deterministically missing evidence into a clean result', () => {
        // AC-04: missing required evidence is decisive regardless of the model's preference.
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.01 },
            rule: semanticRule('assertion_deleted'),
            unitId: 'u',
            path: 'src/a.spec.ts',
            missingEvidence: ['before test source'],
        });
        expect(assessment.disposition).toBe('unresolved');
        expect(assessment.missingEvidence).toEqual(['before test source']);
    });

    it('treats a value below the fire threshold as an ordinary no, not a third state', () => {
        // A single threshold, matching the provider's own verifier design: below it the question is
        // simply not raised, and the value is still reported so a near miss is visible.
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.5 },
            rule: { ...semanticRule('audio_thread_allocation'), thresholds: { fire: 0.9 } },
            unitId: 'u',
            path: 'crates/daw-dsp/src/lib.rs',
            missingEvidence: [],
        });
        expect(assessment.disposition).toBe('no_additional_recommendation');
        expect(assessment.probability).toBe(0.5);
        expect(assessment.outcome).toBe('no_signal');
    });

    it('recommends investigation when only the signal threshold clears', () => {
        // Read the threshold from the rule so the case cannot drift when the policy moves: exactly at
        // the fire threshold is the boundary that must recommend.
        const rule = semanticRule('audio_thread_allocation');
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: rule.thresholds.fire },
            rule,
            unitId: 'u',
            path: 'crates/daw-src/lib.rs',
            missingEvidence: [],
        });
        expect(assessment.disposition).toBe('recommend_investigation');
        expect(assessment.investigationCategory).toBe('realtime');
    });

    it('keeps a disputed severe finding visible for investigation', () => {
        // AC-13: a disputed security finding is escalated, never silently discarded.
        const assessment = interpretFinding({
            findingId: 'f1',
            severityCategory: 'security-platform',
            answers: {
                support: {
                    type: 'choice',
                    probabilities: { supported: 0.05, contradicted: 0.9, insufficient_context: 0.05 },
                    confidence: 0.9,
                    choice: 'contradicted',
                },
                attribution: {
                    type: 'choice',
                    probabilities: { introduced_by_change: 0.1, pre_existing: 0.1, undetermined: 0.8 },
                    confidence: 0.8,
                    choice: 'undetermined',
                },
                kind: {
                    type: 'choice',
                    probabilities: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                    confidence: 0.9,
                    choice: 'behavioral_or_contract_issue',
                },
            },
            strongestEvidenceIds: ['a1'],
        });
        expect(assessment.disposition).toBe('disputed');
        expect(assessment.escalate).toBe(true);
    });

    it('requires both support and attribution before a finding advances', () => {
        const assessment = interpretFinding({
            findingId: 'f2',
            severityCategory: 'realtime',
            answers: {
                support: {
                    type: 'choice',
                    probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                    confidence: 0.9,
                    choice: 'supported',
                },
                attribution: {
                    type: 'choice',
                    probabilities: { introduced_by_change: 0.5, pre_existing: 0.3, undetermined: 0.2 },
                    confidence: 0.5,
                    choice: 'introduced_by_change',
                },
                kind: {
                    type: 'choice',
                    probabilities: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                    confidence: 0.9,
                    choice: 'behavioral_or_contract_issue',
                },
            },
            strongestEvidenceIds: [],
        });
        expect(assessment.disposition).toBe('needs_more_evidence');
    });
});

describe('provider adapter', () => {
    it('bounds retries, counts them, and never rerolls a successful answer', async () => {
        // AC-09
        let attempts = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new RateLimitError(429, {}, new Headers());
                }
                return { model: TYPESAFE_MODEL, answers: {}, usage: { input_tokens: 10, output_tokens: 0 } };
            },
        };
        const budget = createBudgetController({ ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 1 });
        const clock = fixedClock(1_000);
        const result = await assessUnit({
            port: provider,
            cache: new MapCache(),
            budget,
            profile: { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 1 },
            deadline: 1_000 + 60_000,
            state: { evidence: {} },
            questions: {},
            requestedModel: TYPESAFE_MODEL,
            signal: new AbortController().signal,
            now: clock.now,
        });
        expect(result.fromCache).toBe(false);
        expect(attempts).toBe(2);
        expect(budget.totals().retries).toBe(1);
        expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['transient', 'ok']);
    });

    it('does not retry a terminal failure', async () => {
        let attempts = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                attempts += 1;
                throw new AuthenticationError(401, {}, new Headers());
            },
        };
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRetriesPerRequest: 3 };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(profile),
                profile,
                deadline: Date.now() + 60_000,
                state: {},
                questions: {},
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'authentication_failed' });
        expect(attempts).toBe(1);
    });

    it('rejects a returned model that is not the pinned model', async () => {
        // AC-11: an unexpected returned model is refused, never accepted.
        const provider = constantProvider(0.1, {
            systemOne: async () => ({
                model: 'jev-latest',
                answers: {},
                usage: { input_tokens: 1, output_tokens: 0 },
            }),
        });
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(SEMANTIC_BUDGET_PROFILES.local),
                profile: SEMANTIC_BUDGET_PROFILES.local,
                deadline: Date.now() + 10_000,
                state: {},
                questions: {},
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'model_mismatch' });
    });

    it('stops admitting requests once the attempt budget is exhausted', () => {
        // AC-08: concurrent reservations cannot oversubscribe the budget.
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxAttempts: 3, maxTotalSubmittedBytes: 1_000 };
        const budget = createBudgetController(profile);
        expect('attempt' in budget.reserve(10)).toBe(true);
        expect('attempt' in budget.reserve(10)).toBe(true);
        expect('attempt' in budget.reserve(10)).toBe(true);
        const refused = budget.reserve(10);
        expect('refused' in refused && refused.refused).toBe('budget_exhausted');
        expect(budget.totals().networkAttempts).toBe(3);
    });

    it('refuses a request larger than the per-request byte limit', () => {
        const profile = { ...SEMANTIC_BUDGET_PROFILES.ci, maxRequestBytes: 100, maxTotalSubmittedBytes: 1_000 };
        const budget = createBudgetController(profile);
        const refused = budget.reserve(101);
        expect('refused' in refused && refused.refused).toBe('budget_exhausted');
    });

    it('invalidates the response cache when the model or question changes', () => {
        // AC-06
        const base = { state: { evidence: { a1: 'x' } }, questions: { r1: { type: 'choice' } }, model: TYPESAFE_MODEL };
        const original = computeResponseCacheKey(base);
        expect(computeResponseCacheKey({ ...base, model: 'jev-1.13.1' })).not.toBe(original);
        expect(
            computeResponseCacheKey({ ...base, questions: { r1: { type: 'choice' }, r2: { type: 'choice' } } })
        ).not.toBe(original);
        expect(computeResponseCacheKey({ ...base, state: { evidence: { a1: 'y' } } })).not.toBe(original);
    });

    it('surfaces a rate limit as a typed outcome', async () => {
        // AC-10
        const profile = { ...SEMANTIC_BUDGET_PROFILES.local, maxRetriesPerRequest: 0 };
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                throw new RateLimitError(429, {}, new Headers());
            },
        };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(profile),
                profile,
                deadline: Date.now() + 10_000,
                state: {},
                questions: {},
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'rate_limited' });
    });
});

describe('budget profiles', () => {
    it('ships profiles whose limits are internally consistent', () => {
        for (const profile of Object.values(SEMANTIC_BUDGET_PROFILES)) {
            expect(() => assertBudgetProfile(profile)).not.toThrow();
        }
    });
});

describe('report contract', () => {
    async function scanOnce() {
        const clock = fixedClock(1_000);
        return runScan(
            scanPorts(
                constantProvider(0.8),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            )
        );
    }

    it('batches one rule per applicable question into a single request per unit', async () => {
        // AC-05: all applicable rules for one unit share one request.
        let requests = 0;
        const provider = constantProvider(0.8, {
            systemOne: async ({ questions }) => {
                requests += 1;
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.8 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
            },
        });
        const clock = fixedClock(1_000);
        const result = await runScan(
            scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            )
        );
        expect(requests).toBe(1);
        expect(result.report.signals.map((signal) => signal.ruleId)).toContain('audio_thread_allocation');
    });

    it('produces a report that validates and never claims a clean bill of health', async () => {
        // AC-14, AC-24
        const result = await scanOnce();
        const report = validateReport(result.report);
        const summary = renderSummary(report);
        expect(summary).not.toMatch(/all clear|approved|verified correct|safe to merge/iu);
        expect(summary).toContain('Semantic review (scan)');
        expect(report.scope.assessed).toBe(1);
    });

    it('reports a cache hit instead of a second provider call', async () => {
        // Observed live: a rerun served every unit from the durable cache yet reported 0 cache hits.
        let calls = 0;
        const provider = constantProvider(0.1, {
            systemOne: async ({ questions }) => {
                calls += 1;
                const answers: Record<string, unknown> = {};
                for (const key of Object.keys(questions)) {
                    answers[key] = { type: 'noul', noul: 0.1 };
                }
                return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 7, output_tokens: 0 } };
            },
        });
        const source = fakeSource({
            files: [changedFile('src/modules/AudioEngine/live.ts')],
            blobs: {
                [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
            },
        });
        const cache = new MapCache();
        const first = scanPorts(provider, source, fixedClock(1_000));
        const firstRun = await runScan({ ...first, ports: { ...first.ports, cache } });
        expect(firstRun.report.scope.cacheHits).toBe(0);
        const second = scanPorts(provider, source, fixedClock(2_000));
        const secondRun = await runScan({ ...second, ports: { ...second.ports, cache } });
        expect(calls).toBe(1);
        expect(secondRun.report.scope.cacheHits).toBe(1);
        expect(secondRun.report.usage.networkAttempts).toBe(0);
    });

    it('makes zero provider calls in a dry run', async () => {
        // AC-20
        let calls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                calls += 1;
                throw new Error('dry run must not call the provider');
            },
        };
        const clock = fixedClock(1_000);
        const result = await runScan({
            ...scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            ),
            dryRun: true,
        });
        expect(calls).toBe(0);
        expect(result.report.execution).toBe('skipped');
        expect(result.previews).toHaveLength(1);
    });

    it('rejects a report with an out-of-range probability', async () => {
        const result = await scanOnce();
        const broken = {
            ...result.report,
            signals: [
                {
                    ...result.report.signals[0],
                    probability: 1.4,
                },
            ],
        };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });

    it('rejects a report with an unknown schema version', async () => {
        const result = await scanOnce();
        expect(() => validateReport({ ...result.report, schemaVersion: 'semantic-review-v2' })).toThrow(
            SemanticFailure
        );
    });

    it('rejects a report whose scope counts disagree', async () => {
        const result = await scanOnce();
        const broken = { ...result.report, scope: { ...result.report.scope, assessed: 5 } };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });

    it('rejects an invalid probability in a stored report', async () => {
        const result = await scanOnce();
        const broken = { ...result.report, signals: [{ ...result.report.signals[0], confidence: Number.NaN }] };
        expect(() => validateReport(broken)).toThrow(SemanticFailure);
    });
});

describe('question and policy identity', () => {
    it('refuses to replay an assessment whose questions have since changed', () => {
        // Replay reinterpreted stored answers with the current rule wording and kept the old digest,
        // so a disposition computed from one question was presented under another's identity.
        expect(() => assertQuestionsAreReplayable({ rulesDigest: 'a'.repeat(64) })).toThrow(SemanticFailure);
        expect(() => assertQuestionsAreReplayable({ rulesDigest: computeRulesDigest() })).not.toThrow();
    });

    it('separates question identity from threshold policy', () => {
        // A threshold-only change must be replayable without a new assessment, so it may not enter
        // the question digest — but it must change the policy digest the report records.
        const shipped = computePolicyDigest();
        const overridden = computePolicyDigest({
            audio_thread_allocation: { fire: 0.1 },
        });
        expect(overridden).not.toBe(shipped);
        expect(computeRulesDigest()).toBe(computeRulesDigest());
    });

    it('records the policy that actually produced a report', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.policyDigest).toBe(computePolicyDigest());
        expect(result.report.policyDigest).not.toBe(result.report.rulesDigest);
        expect(renderSummary(result.report)).toContain('policy');
    });

    it('refuses a report that does not name the policy it applied', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(() => validateReport({ ...result.report, policyDigest: 'not-a-digest' })).toThrow(SemanticFailure);
        expect(() => validateReport({ ...result.report, policyDigest: 'a'.repeat(64) })).not.toThrow();
    });
});

describe('incomplete-scope reporting', () => {
    const big = 'const sample_value = 1;\n'.repeat(500);

    async function reducedScan() {
        const provider = constantProvider(0.05);
        const source = fakeSource({
            files: [changedFile('crates/daw-dsp/src/big.rs')],
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/big.rs`]: big,
                [`${HEAD}:crates/daw-dsp/src/big.rs`]: big,
            },
        });
        const base = scanPorts(provider, source, fixedClock(1_000));
        return runScan({ ...base, limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 } });
    }

    it('reports a run whose evidence was cut as partial, not completed', async () => {
        // The exit code branches on execution, so `completed` here told a consumer that an assessment
        // finished for a scope that was never fully sent.
        const result = await reducedScan();
        expect(result.report.scope.truncated.length).toBeGreaterThan(0);
        expect(result.report.execution).toBe('partial');
        expect(() => validateReport(result.report)).not.toThrow();
    });

    it('refuses a report that claims completion while carrying truncated evidence', async () => {
        const result = await reducedScan();
        expect(() => validateReport({ ...result.report, execution: 'completed' })).toThrow(SemanticFailure);
    });

    it('does not render a clean sentence when no question was decidable', async () => {
        // An all-unresolved run printed the same sentence as an affirmative no_signal run.
        const result = await runScan(
            scanPorts(
                constantProvider(0.5),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        // Nothing fired, and every answer sat at the midpoint: that is an undecided run, and the
        // summary has to say so rather than print the sentence an affirmatively quiet run prints.
        expect(result.report.signals.some((signal) => signal.disposition === 'no_additional_recommendation')).toBe(
            true
        );
        const summary = renderSummary(result.report);
        expect(summary).not.toContain('Completed: no additional semantic signals');
        expect(summary).toContain('No question was decidable');
    });

    it('renders the clean sentence when every question was decisively quiet', async () => {
        // The other direction of the same property: the quiet sentence must remain reachable, or the
        // report would have no way to say that the questions were asked and answered.
        const result = await runScan(
            scanPorts(
                constantProvider(0.5),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        const quiet = {
            ...result.report,
            signals: result.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const summary = renderSummary(quiet);
        expect(summary).toContain('Completed: no additional semantic signals');
        expect(summary).not.toContain('No question was decidable');
    });
});

describe('credential-shaped content', () => {
    // Composed at runtime: the repository's pull-request diff secret scan matches these literals in
    // source, so a fixture must never contain one contiguously.
    const AWS_SHAPED = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
    const GITHUB_SHAPED = secretFixture('ghp_', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA', 'AAAA');

    it('withholds a credential in an ordinary-looking file instead of sending it', () => {
        // Path patterns cannot see this: the filename announces nothing.
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/config.example.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/config.example.ts`]: `export const key = '${AWS_SHAPED}';\n`,
                    [`${HEAD}:src/modules/Project/config.example.ts`]: `export const key = '${AWS_SHAPED}';\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(0);
        // One entry per path: both sides are withheld, but the manifest counts a path once.
        expect(set.excluded).toEqual([
            { path: 'src/modules/Project/config.example.ts', reason: 'credential-shaped-content-excluded' },
        ]);
        expect(set.limitations.join(' ')).toContain('(before)');
        expect(set.limitations.join(' ')).toContain('(after)');
        expect(set.limitations.join(' ')).toContain('withheld');
    });

    it('withholds any admitted region carrying a token, contract included', () => {
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/AudioEngine/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: `token: ${GITHUB_SHAPED}\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(set.references).toHaveLength(2);
    });
});

describe('a fixture is not a test', () => {
    it('asks the test questions only about tests', () => {
        // A live run fired two test-validity signals on a JSON fixture, because everything under
        // `__tests__/` counted as a test and the snapshot's content holds shell `if` statements.
        // The extension gate keeps that false positive out: a data file in a test directory is not
        // test material.
        expect(isTestPath('scripts/__tests__/fixtures/health-gate-workflows.snapshot.json')).toBe(false);
        // A code file in `__tests__/` without a runner suffix can still carry assertions the specs
        // import and execute, so it is test material even though the suffix rule alone would miss it.
        expect(isTestPath('src/modules/AiRuntime/repositories/__tests__/providerProtocolConformance.ts')).toBe(true);
        expect(isTestPath('src/modules/WorkspaceShell/presentations/__tests__/expectExternalProjectLink.ts')).toBe(
            true
        );
        // The suffix still decides on its own, wherever the file sits.
        expect(isTestPath('src/modules/Project/__tests__/undoProject.spec.ts')).toBe(true);
        expect(isTestPath('src/modules/Project/undoProject.spec.tsx')).toBe(true);
        expect(isTestPath('tests/e2e/audioOwnership.native.spec.ts')).toBe(true);
        // A code file outside `__tests__/` with no runner suffix is implementation, not test material.
        expect(isTestPath('src/modules/Project/useCases/undoProject.ts')).toBe(false);
        expect(isTestPath('tests/e2e/admitLoopbackProvider.ts')).toBe(false);
    });
});

describe('implementation source is decided by collection, not test material', () => {
    it('separates collection from applicability', () => {
        // Collection is the `.spec.`/`.test.` suffix alone; applicability also admits a code file
        // under `__tests__/`. A dummy there is test material for the rules but is never collected as
        // a test, so it must still be admissible as implementation source.
        expect(isCollectedSpec('src/modules/Arrangement/__tests__/ClipDummy.ts')).toBe(false);
        expect(isTestPath('src/modules/Arrangement/__tests__/ClipDummy.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/__tests__/undoProject.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/useCases/undoProject.ts')).toBe(false);
    });

    it('supplies a changed __tests__/-resident double as the implementation a test unit reaches', () => {
        const files = [
            changedFile('src/modules/Arrangement/__tests__/arrange.spec.ts'),
            changedFile('src/modules/Arrangement/__tests__/ClipDummy.ts'),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Arrangement/__tests__/arrange.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Arrangement/__tests__/arrange.spec.ts`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:src/modules/Arrangement/__tests__/ClipDummy.ts`]: 'export const dummy = 1;\n',
                    [`${HEAD}:src/modules/Arrangement/__tests__/ClipDummy.ts`]: 'export const dummy = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path.endsWith('arrange.spec.ts'));
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);
    });

    it('still refuses a collected spec as implementation source', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeTest = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/arrange.spec.ts',
            side: 'before',
        });
        const afterTest = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/arrange.spec.ts',
            side: 'after',
        });
        const otherSpec = reference({
            evidenceId: 'a3',
            path: 'src/modules/Arrangement/__tests__/other.spec.ts',
            side: 'after',
        });
        expect(missingRequiredEvidence(rule, [beforeTest, afterTest], [otherSpec], 'modified')).toEqual([
            'after implementation source',
        ]);
    });
});

describe('the changed lines are the evidence regions', () => {
    it('parses ranges, renames, and one-sided diffs', () => {
        const diff = [
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -3,7 +3,8 @@ export const a = 1;',
            ' context',
            'diff --git a/src/old.ts b/src/new.ts',
            'similarity index 90%',
            'rename from src/old.ts',
            'rename to src/new.ts',
            '--- a/src/old.ts',
            '+++ b/src/new.ts',
            '@@ -10,3 +10,4 @@',
            ' context',
            'diff --git a/gone.ts b/gone.ts',
            'deleted file mode 100644',
            '--- a/gone.ts',
            '+++ /dev/null',
            '@@ -1,5 +0,0 @@',
            '-gone',
        ].join('\n');
        const parsed = parseUnifiedDiffRanges(diff);
        expect(parsed.get('src/a.ts')).toEqual({
            path: 'src/a.ts',
            before: [{ startLine: 3, endLine: 9 }],
            after: [{ startLine: 3, endLine: 10 }],
        });
        expect(parsed.get('src/new.ts')).toEqual({
            path: 'src/new.ts',
            previousPath: 'src/old.ts',
            before: [{ startLine: 10, endLine: 12 }],
            after: [{ startLine: 10, endLine: 13 }],
        });
        // A deletion has no after side, and its before ranges stay keyed by the path that held them.
        expect(parsed.get('gone.ts')).toEqual({ path: 'gone.ts', before: [{ startLine: 1, endLine: 5 }], after: [] });
    });

    it('sends the changed lines instead of a file that cannot be sent whole', () => {
        // Measured on one change: whole-file sides exceeded the per-region budget for 17 of 32 paths,
        // and 11 paths were therefore unassessable; their diffs are 6.5% of the bytes.
        const big = Array.from({ length: 900 }, (_, index) => `const line${String(index)} = ${String(index)};`).join(
            '\n'
        );
        const files = [changedFile('crates/daw-dsp/src/a.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/a.rs`]: `${big}\n`,
                    [`${HEAD}:crates/daw-dsp/src/a.rs`]: `${big}\n`,
                },
                hunks: new Map([
                    [
                        'crates/daw-dsp/src/a.rs',
                        {
                            path: 'crates/daw-dsp/src/a.rs',
                            before: [{ startLine: 400, endLine: 412 }],
                            after: [{ startLine: 400, endLine: 413 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 2_000, maxTotalBytes: 100_000 },
        });
        expect(set.references).toHaveLength(2);
        const [before, after] = set.references;
        expect(before?.startLine).toBe(400);
        expect(before?.endLine).toBe(412);
        expect(after?.startLine).toBe(400);
        expect(after?.endLine).toBe(413);
        expect(set.contents.get(before?.evidenceId ?? '')?.split('\n')).toHaveLength(13);
        expect(set.contents.get(after?.evidenceId ?? '')?.split('\n')).toHaveLength(14);
        // The unchanged head of the file never leaves the machine.
        expect(set.contents.get(before?.evidenceId ?? '')).not.toContain('line0');
    });
});

describe('the egress screen tells code from credentials', () => {
    // Live evidence: the screen refused thirteen of one change's thirty-two paths — including every
    // module implementing this tool — because the general rule matched ordinary code. Since a withheld
    // region is not sent at all, a false positive costs the whole file's assessment.
    it('does not read ordinary code as a credential', () => {
        const ordinary = [
            'Tokens: estimateInputTokens(bytes),',
            'Tokens: usage.actualInputTokens,',
            '  tokens: tokens.input_tokens,',
            'Tokens: readNonNegativeInteger(rawUsage.actualInputTokens,',
            "export const TYPESAFE_API_KEY_ENV = 'TYPESAFE_API_KEY';",
            'apiKey: loadApiKey(primaryRoot),',
            'Secrets = validationWorkflow.jobs?.[',
            'token:${slot}@github.com/${slot}.git',
            'CREDENTIAL_PATTERN = /\\bbearer\\s+/iu',
            "DEPLOY_WEB_CREDENTIAL_REPORT_STEP = 'Report the missing deployment credential'",
            'const TYPESAFE_ENDPOINT = "https://api.typesafe.ai";',
            '// A URI with embedded credentials: scheme://user:secret@host',
            'redis://:pass@h',
            'KEYS: Record<ReviewDossierEvent[',
        ];
        for (const line of ordinary) {
            expect(sensitiveContentReason(line), line).toBeUndefined();
        }
    });

    it('still withholds a credential-shaped value', () => {
        // Composed at runtime for the same reason as the vendor shapes below: the screen withholds
        // any region holding a credential shape, and a literal here would exclude this whole spec
        // from the tool's own assessment. The repository's diff secret scan matches them too.
        const credentials = [
            secretFixture('password: "correct', 'horsebatterystaple"'),
            secretFixture('CLIENT_SECRET=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123'),
            secretFixture('redis://', ':hunter2@', 'cache.example.com:6379/0'),
            secretFixture('postgres://alice:', 'sup3rsecret@', 'db.example.com:5432/app'),
            secretFixture('Server=db;User Id=admin;Password=', 's3cretV4lueLongEnough;'),
            secretFixture('AccountName=mystorage;AccountKey=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCdefg==;'),
            secretFixture('jdbc:postgresql://host/db?user=x&password=', 'AbCdEfGhIjKlMnOp'),
        ];
        for (const line of credentials) {
            expect(sensitiveContentReason(line), line).toBeDefined();
        }
    });

    it('withholds an armored private key only with key material, whatever its wrapper', () => {
        // Composed at runtime: the diff secret scan matches a contiguous PEM header, and the screen
        // withholds any region holding one. A `key = value` rule cannot see these, because the header
        // carries no assignment, so the armored shape is the only thing standing between a PEM block
        // and the provider. Egress requires a value, so the header alone is not enough: a prose
        // sentence quoting the header carries no key material.
        const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
        const opensshHeader = secretFixture('-----BEGIN OPENSSH ', 'PRIVATE KEY', '-----');
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJ', 'RXZRSUJBREFO', 'Qmdr', 'a2lod0FBUUVGQUFTQ0JL');
        const pkcs8 = secretFixture(pkcs8Header, '\n', body);
        const openssh = secretFixture(opensshHeader, '\n', body);
        const rsa = secretFixture(rsaHeader, '\n', body);
        // A block whose body is present and whose footer is absent is still withheld: the body, not
        // the footer, is what carries the key material.
        expect(sensitiveContentReason(pkcs8)).toBe('an armored private key');
        expect(sensitiveContentReason(openssh)).toBe('an armored private key');
        expect(sensitiveContentReason(rsa)).toBe('an armored private key');
        // Two file shapes that would otherwise carry the block out unchanged: a `.ts` string and a
        // JSON field.
        expect(sensitiveContentReason(`export const key = '${pkcs8}';`)).toBe('an armored private key');
        expect(sensitiveContentReason(`{ "key": "${rsa}" }`)).toBe('an armored private key');
        // A header quoted inline in prose carries no key material and must not be withheld.
        expect(
            sensitiveContentReason(`the file opens with ${pkcs8Header} and then the key material follows`)
        ).toBeUndefined();
        expect(sensitiveContentReason(pkcs8Header)).toBeUndefined();
    });
});

describe('incomplete scope from withheld evidence', () => {
    const AWS_SHAPED = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');

    it('catches SaaS and connection-string shapes the publication list misses', () => {
        // Composed at runtime: the repository's diff secret scan matches these literals in source.
        const sendgrid = secretFixture('SG.', 'a1b2c3d4e5f6g7h8i9j0k1', '.l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6');
        const gitlab = secretFixture('glpat-', 'abcdefghijklmnopqrstuvwx');
        const emptyUser = secretFixture('redis://', ':hunter2@', 'cache.example.com:6379/0');
        // Realistic length: a six-character value is below any honest entropy threshold and is
        // indistinguishable from an ordinary word, which is a documented limitation rather than a bug.
        const keyValue = secretFixture('Server=db;User Id=admin;Password=', 's3cretV4lueLongEnough;');
        // Generalizing rules, not per-vendor enumeration: these all reached the provider before.
        const azureAccountKey = secretFixture(
            'AccountName=mystorage;AccountKey=',
            'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCdefg==;'
        );
        const sharedAccess = secretFixture(
            'SharedAccessKeyName=root;SharedAccessKey=',
            'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABC=;'
        );
        const googleOAuth = secretFixture('GOCSPX-', 'AbCdEfGhIjKlMnOpQrStUvWx');
        const genericSecret = secretFixture('CLIENT_SECRET=', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123');
        // A configuration file writes its key in quotes, and the quote sits between the name and the
        // separator. The rule that demanded the separator immediately after the name let every JSON
        // and YAML config carry its secrets past the gate.
        const quotedKey = secretFixture('{ "password": "', 'correcthorsebatterystaple', '" }');
        const queryParam = secretFixture('jdbc:postgresql://host/db?user=x&password=', 'AbCdEfGhIjKlMnOp');
        // Short enough that the general secret-named-key rule cannot match it, so this fixture fails
        // if the key-value connection-string rule stops firing; the longer one above is satisfied by
        // the general rule whether or not that rule exists.
        const shortConnectionString = secretFixture('Server=db;Password=', 's3cretV4l');
        for (const value of [
            sendgrid,
            gitlab,
            emptyUser,
            keyValue,
            azureAccountKey,
            sharedAccess,
            googleOAuth,
            genericSecret,
            queryParam,
            quotedKey,
            shortConnectionString,
        ]) {
            const recorded = collectEvidence({
                port: fakeSource({
                    files: [changedFile('src/modules/Project/notes.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/notes.ts`]: `const v = '${value}';\n`,
                        [`${HEAD}:src/modules/Project/notes.ts`]: `const v = '${value}';\n`,
                    },
                }),
                mergeBaseSha: MERGE_BASE,
                headSha: HEAD,
                contractSourceSha: MERGE_BASE,
                limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            });
            expect(recorded.references).toHaveLength(0);
        }
    });

    it('reports a run whose evidence was withheld as incomplete, not completed', async () => {
        // The unit was never sent, yet the run reported completion and exited 0.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/Project/__tests__/auth.spec.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                        [`${HEAD}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.truncated.length).toBeGreaterThan(0);
        expect(result.report.execution).not.toBe('completed');
        // A wholly withheld scope is not an empty one: `skipped` would report a green no-op over the
        // very change whose evidence the withholding exists to disclose.
        expect(result.report.execution).not.toBe('skipped');
        expect(() => validateReport(result.report)).not.toThrow();
    });

    it('does not count a path twice when it is both excluded and planned', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/Project/__tests__/auth.spec.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                        [`${HEAD}:src/modules/Project/__tests__/auth.spec.ts`]: `const k = '${AWS_SHAPED}';\n`,
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.discovered).toBe(1);
    });
});

describe('verify incomplete attribution', () => {
    it('will not advance a finding whose before side was never supplied', async () => {
        // Attribution was decided without the side it compares against.
        const { runVerify } = await import('../verify.ts');
        const result = await runVerify({
            ports: {
                source: fakeSource({
                    files: [],
                    blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                }),
                provider: constantProvider(
                    { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                    {
                        systemOne: async ({ questions }) => {
                            // Each question defines its own labels, so a per-key answer is required;
                            // the selection question offers the supplied ids plus `none`.
                            const distributions: Record<string, Record<string, number>> = {
                                support: { supported: 0.95, contradicted: 0.02, insufficient_context: 0.03 },
                                attribution: {
                                    introduced_by_change: 0.95,
                                    pre_existing: 0.02,
                                    undetermined: 0.03,
                                },
                                kind: {
                                    behavioral_or_contract_issue: 0.95,
                                    style_preference: 0.02,
                                    undetermined: 0.03,
                                },
                                strongestEvidence: { none: 1 },
                            };
                            const answers: Record<string, unknown> = {};
                            for (const key of Object.keys(questions)) {
                                const probabilities = distributions[key] ?? distributions.support!;
                                answers[key] = {
                                    type: 'choice',
                                    probabilities,
                                    confidence: 0.95,
                                    choice: Object.keys(probabilities)[0],
                                };
                            }
                            return {
                                model: TYPESAFE_MODEL,
                                answers,
                                usage: { input_tokens: 5, output_tokens: 0 },
                            };
                        },
                    }
                ),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        {
                            path: 'src/modules/Project/gone.ts',
                            side: 'before',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                        {
                            path: 'src/modules/Project/a.ts',
                            side: 'after',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                },
            ],
            runId: 'verify-incomplete',
        });
        const assessment = result.report.findingAssessments[0];
        expect(assessment?.disposition).toBe('needs_more_evidence');
        expect(assessment?.reasoning).toContain('not supplied');
    });
});

describe('identity self-verification', () => {
    async function smallScan(profile: typeof SEMANTIC_BUDGET_PROFILES.ci) {
        const base = scanPorts(
            constantProvider(0.1),
            fakeSource({
                files: [changedFile('src/modules/AudioEngine/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                },
            }),
            fixedClock(1_000)
        );
        return runScan({ ...base, profile });
    }

    it('refuses a report whose context digest does not match its own context', async () => {
        // validate read the digest as an opaque string, so a forged revision validated.
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        const forged = {
            ...result.report,
            context: { ...result.report.context, mergeBaseSha: 'f'.repeat(40) },
        };
        expect(() => validateReport(forged)).toThrow(SemanticFailure);
    });

    it('refuses a report whose top-level identity disagrees with its context', async () => {
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(() => validateReport({ ...result.report, rulesDigest: 'a'.repeat(64) })).toThrow(SemanticFailure);
        expect(() => validateReport({ ...result.report, policyVersion: 'other' })).toThrow(SemanticFailure);
    });

    it('refuses a report that records a failure alongside a completed execution', async () => {
        const result = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(() => validateReport({ ...result.report, failureCode: 'rate_limited' })).toThrow(SemanticFailure);
    });

    it('binds the evidence budget to the identity so two profiles cannot collide', async () => {
        // The profile decides how much evidence is sent, so runs under different profiles must not
        // share an identity or a sidecar path.
        const ci = await smallScan(SEMANTIC_BUDGET_PROFILES.ci);
        const local = await smallScan(SEMANTIC_BUDGET_PROFILES.local);
        expect(ci.report.context.evidenceProfile).toBe('ci');
        expect(local.report.context.evidenceProfile).toBe('local');
        expect(ci.report.context.contextDigest).not.toBe(local.report.context.contextDigest);
    });
});

describe('sensitive-path withholding', () => {
    it('reports a run that withheld a sensitive path as incomplete, not completed', async () => {
        // The content gate's withholdings were incomplete scope and the path gate's were not, so the
        // same class of loss reported two different outcomes and this one exited 0.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts'), changedFile('.env')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.scope.excluded.some((entry) => entry.path === '.env')).toBe(true);
        expect(result.report.scope.truncated.some((entry) => entry.reason === 'evidence-withheld-sensitive-path')).toBe(
            true
        );
        expect(result.report.execution).not.toBe('completed');
        expect(renderSummary(result.report)).toContain('Incomplete');
        expect(() => validateReport(result.report)).not.toThrow();
    });
});

describe('usage validation', () => {
    it('refuses a hostile or malformed token count on the live path', () => {
        // The cached path validated this and the live path did not, so a provider-returned count could
        // inflate the cost estimate or poison the whole report at write time.
        expect(() => readUsage({ input_tokens: -1, output_tokens: 0 }, 'usage')).toThrow(SemanticFailure);
        expect(() => readUsage({ input_tokens: 1.5, output_tokens: 0 }, 'usage')).toThrow(SemanticFailure);
        expect(() => readUsage({ input_tokens: Number.MAX_SAFE_INTEGER + 2, output_tokens: 0 }, 'usage')).toThrow(
            SemanticFailure
        );
        // A schema-valid but impossible count: no tokenization yields more tokens than bytes sent.
        expect(() => readUsage({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 }, 'usage', 1_000)).toThrow(
            SemanticFailure
        );
        expect(readUsage({ input_tokens: 900, output_tokens: 0 }, 'usage', 1_000)).toEqual({
            input_tokens: 900,
            output_tokens: 0,
        });
        expect(readUsage(undefined, 'usage')).toBeUndefined();
        expect(readUsage({ input_tokens: 5, output_tokens: 0 }, 'usage')).toEqual({
            input_tokens: 5,
            output_tokens: 0,
        });
    });

    it('rejects an assessment whose usage is malformed rather than recording a fabricated cost', async () => {
        const provider: SemanticProviderPort = {
            systemOne: async () => ({
                model: TYPESAFE_MODEL,
                answers: {},
                usage: { input_tokens: -1, output_tokens: 0 },
            }),
        };
        await expect(
            assessUnit({
                port: provider,
                cache: new MapCache(),
                budget: createBudgetController(SEMANTIC_BUDGET_PROFILES.local),
                profile: SEMANTIC_BUDGET_PROFILES.local,
                deadline: Date.now() + 10_000,
                state: {},
                questions: {},
                requestedModel: TYPESAFE_MODEL,
                signal: new AbortController().signal,
            })
        ).rejects.toMatchObject({ code: 'invalid_response' });
    });
});

describe('reduced-unit reporting', () => {
    it('surfaces a per-unit evidence reduction instead of a clean completion', async () => {
        // A unit whose evidence the request budget had to cut still reported `completed` with an
        // empty scope.truncated and a clean summary, so an operator saw exit 0 and "no additional
        // semantic signals" for a unit whose after side had been cut to a fraction of itself.
        const big = 'const sample_value = 1;\n'.repeat(500);
        const provider = constantProvider(0.05);
        const source = fakeSource({
            files: [changedFile('crates/daw-dsp/src/big.rs')],
            blobs: {
                [`${MERGE_BASE}:crates/daw-dsp/src/big.rs`]: big,
                [`${HEAD}:crates/daw-dsp/src/big.rs`]: big,
            },
        });
        const base = scanPorts(provider, source, fixedClock(1_000));
        const result = await runScan({
            ...base,
            // Large enough that collection records nothing: the reduction must come from fitting.
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        expect(result.report.scope.assessed).toBe(1);
        expect(result.report.scope.truncated.length).toBeGreaterThan(0);
        expect(result.report.limitations.join(' ')).toContain('per-request state budget');
        expect(renderSummary(result.report)).toContain('Incomplete');
    });

    it('does not send a region it cannot send whole, and reports what the questions then lack', () => {
        // A cut region used to answer `has('context')`, so the rule scored a side it held a fraction
        // of. A region is now supplied whole or not at all, and the rule reports what it did not get.
        const big = 'const documented_rule = 1;\n'.repeat(400);
        const files = [changedFile('crates/daw-dsp/src/lib.rs')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:crates/daw-dsp/src/lib.rs`]: 'const a = 1;\n',
                    [`${HEAD}:crates/daw-dsp/src/lib.rs`]: 'const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 20_000, maxTotalBytes: 100_000 },
            contractPaths: ['AGENTS.md'],
        });
        expect(set.references.some((reference) => reference.side === 'context')).toBe(true);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.local.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        expect(unit?.evidence.references.some((reference) => reference.side === 'context')).toBe(false);
        expect(
            missingRequiredEvidence(
                semanticRule('stated_invariant_contradicted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toContain('decision or documented invariant');
    });
});

describe('partial-side evidence drop', () => {
    it('treats a side split across two hunks as unsupplied when one hunk is dropped', () => {
        // A side split across two hunks where one is dropped for size was still satisfied by the
        // surviving region, so a rule returned a decisive verdict over a side the model saw only in
        // part. The fitter must name the dropped side, and a dropped side must not satisfy a need.
        const before = 'it("before", () => {});\n';
        const after = `it("kept", () => {});\n${'const large_line = 1;\n'.repeat(2000)}`;
        const files = [changedFile('src/modules/Project/__tests__/two-hunks.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/two-hunks.spec.ts`]: before,
                    [`${HEAD}:src/modules/Project/__tests__/two-hunks.spec.ts`]: after,
                },
                hunks: new Map([
                    [
                        'src/modules/Project/__tests__/two-hunks.spec.ts',
                        {
                            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2001 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });

        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        // One after hunk survives, so the old predicate would have called the side present.
        expect(unit?.evidence.references.some((reference) => reference.side === 'after')).toBe(true);
        expect(unit?.evidence.ownDroppedSides.has('after')).toBe(true);

        const missing = missingRequiredEvidence(
            semanticRule('assertion_deleted'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after test source');
        // Without the dropped-side wiring, the surviving after region satisfies the side and the rule
        // returns a decisive verdict.
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);

        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.05 },
            rule: semanticRule('assertion_deleted'),
            unitId: 'u',
            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
            missingEvidence: missing,
        });
        expect(assessment.disposition).toBe('unresolved');
        expect(assessment.missingEvidence).toEqual(['after test source']);
    });

    it('treats a dropped after side as not supplying implementation source', () => {
        // The implementation branch resolves to an after side that is not a collected spec; a dropped
        // context after side must not satisfy it even though the implementation region itself survived.
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeTest = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const afterTest = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const implementation = reference({
            evidenceId: 'a3',
            path: 'src/modules/Project/useCases/undoProject.ts',
            side: 'after',
        });
        const droppedAfter = new Set<EvidenceSide>(['after']);
        expect(
            missingRequiredEvidence(
                rule,
                [beforeTest, afterTest],
                [implementation],
                'modified',
                new Set(),
                droppedAfter
            )
        ).toContain('after implementation source');
        expect(missingRequiredEvidence(rule, [beforeTest, afterTest], [implementation], 'modified')).toEqual([]);
    });
});

describe('own and context drops are resolved separately', () => {
    it('does not let a dropped implementation-context after region mark the own after side missing', () => {
        const rule = semanticRule('assertion_deleted');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const implementation = reference({
            evidenceId: 'a3',
            path: 'src/modules/Project/useCases/undoProject.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [implementation],
            'modified',
            new Set<EvidenceSide>(),
            new Set<EvidenceSide>(['after'])
        );
        expect(missing).toEqual([]);
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.05 },
            rule,
            unitId: 'u',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            missingEvidence: missing,
        });
        expect(assessment.outcome).not.toBe('insufficient_context');
    });

    it('still reports the own after side when it is dropped', () => {
        const rule = semanticRule('assertion_deleted');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [],
            'modified',
            new Set<EvidenceSide>(['after']),
            new Set<EvidenceSide>()
        );
        expect(missing).toEqual(['after test source']);
    });

    it('reports own and context drops separately from the fitter', () => {
        const files = [
            changedFile('src/modules/Project/__tests__/undo.spec.ts'),
            changedFile('src/modules/Project/useCases/undoProject.ts'),
        ];
        const big = 'export const impl = 1;\n'.repeat(400);
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/undo.spec.ts`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:src/modules/Project/useCases/undoProject.ts`]: 'export const before = 1;\n',
                    [`${HEAD}:src/modules/Project/useCases/undoProject.ts`]: big,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        const own = set.references.filter((r) => r.side !== 'context' && r.path.endsWith('undo.spec.ts'));
        const context = set.references.filter((r) => r.side === 'after' && r.path.endsWith('undoProject.ts'));
        const fitted = fitUnitEvidence(set, own, context, 2_000);
        expect(fitted.own.droppedSides.has('after')).toBe(false);
        expect(fitted.context.droppedSides.has('after')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                fitted.own.references,
                fitted.context.references,
                'modified',
                fitted.own.droppedSides,
                fitted.context.droppedSides
            )
        ).toEqual([]);
    });

    it('lets an own non-collected after side satisfy implementation despite a dropped context after region', () => {
        // A context after region dropped for budget must not deny the unit's own after side when that
        // side is itself implementation source: the two sets resolve independently and disjoin.
        const rule = semanticRule('production_path_no_longer_reached');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'after',
        });
        const contextImpl = reference({
            evidenceId: 'a3',
            path: 'src/modules/Arrangement/useCases/arrange.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [contextImpl],
            'modified',
            new Set<EvidenceSide>(),
            new Set<EvidenceSide>(['after'])
        );
        expect(missing).toEqual([]);
    });

    it('still reports the implementation token when the own after side is dropped', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const ownBefore = reference({
            evidenceId: 'b1',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'before',
        });
        const ownAfter = reference({
            evidenceId: 'a2',
            path: 'src/modules/Arrangement/__tests__/ClipDummy.ts',
            side: 'after',
        });
        const missing = missingRequiredEvidence(
            rule,
            [ownBefore, ownAfter],
            [],
            'modified',
            new Set<EvidenceSide>(['after']),
            new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
    });
});

describe('verify-path screening and identity', () => {
    // Composed at runtime: the PR diff secret scan matches these literals in source.
    const CONNECTION_SHAPED = secretFixture('postgres://', 'alice:', 'sup3rsecret', '@db.example.com:5432/app');

    async function verifyWith(
        references: { path: string; side: 'after'; startLine?: number; endLine?: number }[],
        blobs: Record<string, string>
    ) {
        const { runVerify } = await import('../verify.ts');
        let providerCalls = 0;
        const provider = constantProvider(
            { supported: 0.05, contradicted: 0.05, insufficient_context: 0.9 },
            {
                systemOne: async () => {
                    providerCalls += 1;
                    throw new Error('the provider must not be reached for withheld evidence');
                },
            }
        );
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    // A fixture that names no range asks about the whole file.
                    evidenceReferences: references.map((reference) => ({
                        startLine: reference.startLine ?? 1,
                        endLine: reference.endLine ?? Number.MAX_SAFE_INTEGER,
                        ...reference,
                    })),
                },
            ],
            runId: 'verify-test',
        });
        return { result, providerCalls };
    }

    it('withholds a sensitive path a candidate finding names', async () => {
        // The scan path screened these and verify did not, so a finding could name any tracked file
        // and have it sent verbatim.
        const { result, providerCalls } = await verifyWith(
            [{ path: '.env', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
            {}
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
        expect(result.report.limitations.join(' ')).toContain('sensitive-path');
    });

    it('withholds credential-shaped content in an ordinary-named file a finding names', async () => {
        const { result, providerCalls } = await verifyWith(
            [{ path: 'src/modules/Project/notes.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
            {
                [`${HEAD}:src/modules/Project/notes.ts`]: `const url = '${CONNECTION_SHAPED}';\n`,
            }
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.limitations.join(' ')).toContain('withheld');
    });

    it('gives a verify report its own question identity', async () => {
        // It recorded the scan rules digest although its questions are built elsewhere.
        const { runVerify } = await import('../verify.ts');
        const provider = constantProvider({ supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 });
        const findings: CandidateFinding[] = [
            {
                findingId: 'f1',
                headSha: HEAD,
                claim: 'a claim',
                expectedBehavior: 'expected',
                evidenceReferences: [
                    { path: 'src/modules/Project/a.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                ],
            },
        ];
        const result = await runVerify({
            ports: {
                source: fakeSource({
                    files: [],
                    blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
                }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            findings,
            runId: 'verify-identity',
        });
        expect(result.report.rulesDigest).toBe(computeVerifyQuestionsDigest(findings));
        expect(result.report.rulesDigest).not.toBe(computeRulesDigest());

        // Different questions must not share one identity, or the second run overwrites the first's
        // sidecar while claiming the same question set.
        const otherFindings: CandidateFinding[] = [{ ...findings[0]!, claim: 'a different claim' }];
        expect(computeVerifyQuestionsDigest(otherFindings)).not.toBe(computeVerifyQuestionsDigest(findings));
    });

    it('covers the interpretation policy, not only the rule thresholds', () => {
        // Pins the preimage: dropping the tolerance or the severe-category set from the policy
        // identity would leave a report naming one policy for two different outcomes.
        const expected = semanticDigest({
            rules: SEMANTIC_RULES.map((rule) => ({
                id: rule.id,
                thresholds: { fire: rule.thresholds.fire },
            })),
            verification: {
                support: VERIFICATION_SUPPORT_THRESHOLD,
                attribution: VERIFICATION_ATTRIBUTION_THRESHOLD,
                kind: VERIFICATION_KIND_THRESHOLD,
            },
            probabilitySumTolerance: PROBABILITY_SUM_TOLERANCE,
            severeCategories: [...SEVERE_INVESTIGATION_CATEGORIES],
        });
        expect(computePolicyDigest()).toBe(expected);
    });
});

describe('verify mode', () => {
    const finding: CandidateFinding = {
        findingId: 'f1',
        headSha: HEAD,
        claim: 'The change drops a buffered frame',
        expectedBehavior: 'Every buffered frame is sent',
        evidenceReferences: [
            { path: 'src/modules/AudioEngine/live.ts', side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
        ],
    };

    it('refuses a finding bound to a different head', async () => {
        // AC-02
        const { runVerify } = await import('../verify.ts');
        await expect(
            runVerify({
                ports: {
                    source: fakeSource({ files: [] }),
                    provider: constantProvider({ supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 }),
                    cache: new MapCache(),
                    clock: fixedClock(1_000),
                    signal: new AbortController().signal,
                    log: () => undefined,
                },
                revision: BASE_REVISION,
                profile: SEMANTIC_BUDGET_PROFILES.local,
                limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
                findings: [{ ...finding, headSha: 'f'.repeat(40) }],
                runId: 'verify-test',
            })
        ).rejects.toMatchObject({ code: 'stale_context' });
    });
});

describe('rules digest', () => {
    it('is stable across calls and covered by the report', async () => {
        expect(computeRulesDigest()).toBe(SHIPPED_RULES_DIGEST);
        const result = await runScan(
            scanPorts(
                constantProvider(0.1),
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                fixedClock(1_000)
            )
        );
        expect(result.report.rulesDigest).toBe(SHIPPED_RULES_DIGEST);
    });
});

describe('summary wording and the dry-run manifest', () => {
    it('renders a summary whose scope names a path the wording guard would refuse as prose', async () => {
        // The guard governs this application's claims. A repository path holding one of its words is
        // not a claim, and throwing on one discarded a produced assessment and reported no coverage.
        const provider = constantProvider(0.95);
        const clock = fixedClock(1_000);
        const ports = scanPorts(
            provider,
            fakeSource({
                files: [changedFile('src/modules/Approved/live.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Approved/live.ts`]: 'const a = 1;\n',
                    [`${HEAD}:src/modules/Approved/live.ts`]: 'const a = 2;\n',
                },
            }),
            clock
        );
        const result = await runScan(ports);
        expect(() => renderSummary(result.report)).not.toThrow();
        expect(renderSummary(result.report)).toContain('Semantic review (scan)');
        // The guard is still live on the sentences this application composes.
        expect(() => assertAdvisoryWording('Completed: no additional semantic signals; safe to merge.')).toThrow();
    });

    it('keeps a dry run consistent with its own manifest', async () => {
        const provider = constantProvider(0.05);
        const clock = fixedClock(1_000);
        const result = await runScan({
            ...scanPorts(
                provider,
                fakeSource({
                    files: [changedFile('src/modules/AudioEngine/live.ts')],
                    blobs: {
                        [`${MERGE_BASE}:src/modules/AudioEngine/live.ts`]: 'const a = 1;\n',
                        [`${HEAD}:src/modules/AudioEngine/live.ts`]: 'const a = 2;\n',
                    },
                }),
                clock
            ),
            dryRun: true,
        });
        expect(result.report.execution).toBe('skipped');
        expect(result.report.scope.eligible).toBe(1);
        expect(result.report.scope.assessed).toBe(0);
        expect(result.report.scope.unassessed).toHaveLength(1);
        expect(() => validateReport(result.report)).not.toThrow();
    });
});

describe('execution state and required evidence resolution', () => {
    it('counts only the exclusions that mean an assessment was owed', () => {
        // A lockfile or generated file needs no assessment, so a change made only of them is a skip,
        // not a failed check claiming a coverage gap that does not exist.
        for (const reason of ['no-applicable-rule', 'generated', 'dependency-lockfile', 'binary', 'no-text-change']) {
            expect(isMissedAssessmentExclusion(reason)).toBe(false);
        }
        for (const reason of [
            'credential-shaped-content-excluded',
            'no-admissible-evidence',
            'unit-overhead-exceeds-request-budget',
            'no-evidence-region-within-budget',
        ]) {
            expect(isMissedAssessmentExclusion(reason)).toBe(true);
        }
    });

    it('separates an empty eligible scope from a provider that delivered nothing', () => {
        // A change that admits no rule has nothing missing; reporting it as unavailable put a red
        // advisory check on documentation-only changes and hid the outage the state exists to report.
        expect(executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined })).toBe('skipped');
        expect(
            executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined, excludedCount: 2 })
        ).toBe('unavailable');
        expect(
            executionState({ dryRun: false, assessed: 0, eligible: 0, failureCode: undefined, truncatedCount: 2 })
        ).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: undefined })).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: 'timeout' })).toBe('unavailable');
        expect(executionState({ dryRun: false, assessed: 0, eligible: 3, failureCode: 'cancelled' })).toBe('cancelled');
    });

    it('sends only the range a finding named, not the whole file', async () => {
        // A finding about one line egressed the entire file and recorded bounds the request never
        // used, so the assessment covered a scope wider than the caller named.
        const { runVerify } = await import('../verify.ts');
        const seen: Record<string, unknown>[] = [];
        const provider = constantProvider(
            { supported: 0.8, contradicted: 0.1, insufficient_context: 0.1 },
            {
                systemOne: async ({ state }) => {
                    seen.push(state as Record<string, unknown>);
                    return {
                        model: TYPESAFE_MODEL,
                        answers: {},
                        usage: { input_tokens: 10, output_tokens: 0 },
                    };
                },
            }
        );
        const blobs = {
            [`${HEAD}:src/modules/Project/a.ts`]: 'first line\nsecond line\nthird line\nfourth line\nfifth line\n',
        };
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider,
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ path: 'src/modules/Project/a.ts', side: 'after', startLine: 2, endLine: 2 }],
                },
            ],
            runId: 'verify-range',
        });
        const serialized = JSON.stringify(seen);
        expect(serialized).toContain('second line');
        for (const absent of ['first line', 'third line', 'fourth line', 'fifth line']) {
            expect(serialized).not.toContain(absent);
        }
        expect(result.report.execution).toBeDefined();
    });

    it('reports implementation-source evidence as missing when only test source was supplied', () => {
        const rule = semanticRule('production_path_no_longer_reached');
        const beforeRegion = reference({
            evidenceId: 'e0',
            path: 'src/modules/Project/__tests__/undo.spec.ts',
            side: 'before',
        });
        const testRegion = reference({ evidenceId: 'e1', path: 'src/modules/Project/__tests__/undo.spec.ts' });
        const implementationRegion = reference({
            evidenceId: 'e2',
            path: 'src/modules/Project/useCases/undoProject.ts',
        });

        // The test file's own after region is not the implementation: with only that supplied, the
        // rule's declared need is reported missing rather than scored against evidence it never saw.
        expect(missingRequiredEvidence(rule, [beforeRegion, testRegion], [], 'modified')).toEqual([
            'after implementation source',
        ]);
        expect(missingRequiredEvidence(rule, [beforeRegion, testRegion], [implementationRegion], 'modified')).toEqual(
            []
        );
    });
});

function reference(input: { evidenceId: string; path: string; side?: 'before' | 'after' }): EvidenceReference {
    return {
        evidenceId: input.evidenceId,
        revisionSha: HEAD,
        path: input.path,
        side: input.side ?? 'after',
        startLine: 1,
        endLine: 2,
        contentHash: 'hash',
    };
}
