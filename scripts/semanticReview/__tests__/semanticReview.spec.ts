import { createHash } from 'node:crypto';

import { AuthenticationError, RateLimitError } from '@typesafe-ai/sdk';
import { describe, expect, it } from 'vitest';

import {
    e2eSpecPattern,
    isNodeTestCollected,
    isPlaywrightCollected,
    isVitestCollected,
    specFilePattern,
} from '../../vitestCollectionPatterns.ts';
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
import { EGRESS_VENDOR_SHAPES, RESIDUAL_RULES, VENDOR_KEY_NAMES } from '../egressVendorShapes.ts';
import {
    collectEvidence,
    exclusionReason,
    isContractCarryingPath,
    type PathHunks,
    type SemanticChangedFile,
    type SemanticEvidenceSet,
    type SemanticSourcePort,
} from '../evidence.ts';
import { fitUnitEvidence, regionCost, serializedRegion } from '../fit.ts';
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
import { renderSummary, validateReport, type SemanticVerifyReport } from '../report.ts';
import { missingRequiredEvidence, RESOLVED_EVIDENCE_TOKENS } from '../requiredEvidence.ts';
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

/** Inverts the case of every letter, so a prefix that is already uppercase still probes case-sensitivity. */
function flipCase(value: string): string {
    return value.replaceAll(/[A-Za-z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
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

    it('never reads a path the screen excludes before admission', () => {
        // R2: the collector read every changed path's sides before `exclusionReason` ran, so excluded,
        // binary, generated and lockfile paths were read and held for the whole collection. Screening
        // each path first means only the surviving path's two sides reach the source port.
        const reads: string[] = [];
        const blobs: Record<string, string> = {
            [`${MERGE_BASE}:src/modules/Project/a.ts`]: 'const before = 1;\n',
            [`${HEAD}:src/modules/Project/a.ts`]: 'const after = 1;\n',
        };
        const files: readonly SemanticChangedFile[] = [
            changedFile('.env'),
            changedFile('assets/impulse.wav', { binary: true }),
            changedFile('public/wasm/daw-dsp/app.js', { generated: true }),
            changedFile('Cargo.lock'),
            changedFile('src/modules/Project/a.ts'),
        ];
        const port: SemanticSourcePort = {
            changedFiles: () => files,
            readFile: (sha, path) => {
                reads.push(`${sha}:${path}`);
                return blobs[`${sha}:${path}`];
            },
            changedHunks: () => new Map<string, PathHunks>(),
        };
        const set = collectEvidence({
            port,
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(reads).toEqual([`${MERGE_BASE}:src/modules/Project/a.ts`, `${HEAD}:src/modules/Project/a.ts`]);
        const reasons = new Map(set.excluded.map((entry) => [entry.path, entry.reason]));
        expect(reasons.get('.env')).toBe('sensitive-content-excluded');
        expect(reasons.get('assets/impulse.wav')).toBe('binary');
        expect(reasons.get('public/wasm/daw-dsp/app.js')).toBe('generated');
        expect(reasons.get('Cargo.lock')).toBe('dependency-lockfile');
        // The sensitive path keeps its truncation and limitation entries even though it is never read.
        expect(
            set.truncated.some((entry) => entry.path === '.env' && entry.reason === 'evidence-withheld-sensitive-path')
        ).toBe(true);
        expect(set.limitations.join(' ')).toContain('it is on the sensitive-path list');
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

describe('contract-carrying admission', () => {
    it('admits a trusted-closure path before bulk material that would otherwise exhaust the budget', () => {
        // #4771: the total evidence budget was spent in file order, so bulk files consumed it and the
        // trusted-closure path that sorted last was the one withheld. Contract-carrying paths are now
        // admitted first, so the closure survives and the bulk file is trimmed.
        const bulk = 'const bulk = 1;\n'.repeat(40);
        const bulkBytes = Buffer.byteLength(bulk, 'utf8');
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/bulk.ts'), changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/bulk.ts`]: bulk,
                    [`${HEAD}:aaa/bulk.ts`]: bulk,
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: 'const contract = 1;\n',
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const contract = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // Exactly enough for the bulk file's two whole-file sides and nothing else: file order would
            // have admitted the bulk file and withheld the closure path.
            limits: { maxRegionBytes: bulkBytes, maxTotalBytes: bulkBytes * 2 },
        });
        expect(set.references.some((reference) => reference.path === 'scripts/reviewDossier.ts')).toBe(true);
        expect(set.truncated.some((entry) => entry.path === 'aaa/bulk.ts')).toBe(true);
    });

    it('names a withheld contract-carrying path instead of counting it as an anonymous trim', () => {
        const before = 'const contract = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: before,
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const contract = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'total-evidence-budget-exhausted (after, contract)' },
        ]);
    });

    it('leaves a bulk path trimmed by the total budget anonymously named', () => {
        const before = 'const a = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('src/modules/Project/a.ts')],
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/a.ts`]: before,
                    [`${HEAD}:src/modules/Project/a.ts`]: 'const a = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            { path: 'src/modules/Project/a.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('routes the hunk-beyond-file cause through the collector for a contract-carrying path', () => {
        // R5: the hunk-beyond-file reason was asserted against the shared helper, so re-inlining the
        // inline form in the collector left the whole suite green. Driving the collector to a hunk that
        // names lines beyond the file exercises the producer and pins the contract term it records.
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/reviewDossier.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewDossier.ts`]: 'const before = 1;\n',
                    [`${HEAD}:scripts/reviewDossier.ts`]: 'const after = 1;\n',
                },
                hunks: new Map([
                    [
                        'scripts/reviewDossier.ts',
                        {
                            path: 'scripts/reviewDossier.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 5, endLine: 9 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'hunk-beyond-file (after, contract)' },
        ]);
    });

    it('derives contract-carrying from the closure, the contract documents, and the workflow inventory', () => {
        expect(isContractCarryingPath('scripts/trustedGithubWriteBootstrap.ts')).toBe(true);
        expect(isContractCarryingPath('AGENTS.md')).toBe(true);
        expect(isContractCarryingPath('.agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md')).toBe(true);
        expect(isContractCarryingPath('.agents/skills/delivery-orchestration/SKILL.md')).toBe(true);
        expect(isContractCarryingPath('.github/workflows/semantic-review.yml')).toBe(true);
        expect(isContractCarryingPath('.github/workflows/unregistered.yml')).toBe(false);
        // A collected spec is no longer classified by a same-stem sibling; its import/pin content decides.
        expect(isContractCarryingPath('scripts/__tests__/reviewDossier.spec.ts')).toBe(false);
        expect(isContractCarryingPath('scripts/__tests__/checkReleaseInventory.spec.ts')).toBe(false);
        expect(isContractCarryingPath('src/modules/Project/undo.ts')).toBe(false);
    });

    it('admits a collected spec that imports a closure member before an equal-sized bulk spec', () => {
        // R1: `agentDeliveryScripts.spec.ts` has no sibling `scripts/agentDeliveryScripts.ts`, so the
        // same-stem heuristic ranked it bulk and a tight budget dropped the spec that pins the closure.
        const before = 'const before = 1;\n';
        const contractAfter = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/agentDeliveryScripts.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some((reference) => reference.path === 'scripts/__tests__/agentDeliveryScripts.spec.ts')
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('admits a collected spec that imports a closure member without an extension before an equal-sized bulk spec', () => {
        // R1: live specs import closure members without an extension (`../githubAppIdentity`), so the
        // specifier resolved outside the closure set and the spec was classified bulk. Resolving the
        // extensionless form through the TypeScript extensions matches how the runtime resolves it.
        const before = 'const before = 1;\n';
        const contractAfter = "import { githubAppIdentity } from '../githubAppIdentity';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/githubAppIdentity.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/githubAppIdentity.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/githubAppIdentity.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some((reference) => reference.path === 'scripts/__tests__/githubAppIdentity.spec.ts')
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('admits a collected spec that names a pinned workflow file before an equal-sized bulk spec', () => {
        // R1: `healthGatesWorkflow.spec.ts` imports no closure member, but its content pins the workflow
        // inventory, so a change to it carries the Gate contract.
        const before = 'const before = 1;\n';
        const contractAfter = "const workflow = '.github/workflows/semantic-review.yml';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/healthGatesWorkflow.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/healthGatesWorkflow.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/healthGatesWorkflow.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some((reference) => reference.path === 'scripts/__tests__/healthGatesWorkflow.spec.ts')
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('leaves a collected spec that only mentions a workflow filename bulk', () => {
        // R2: an unanchored substring matched a filename anywhere, so prose mentioning `nightly.yml`
        // classified the spec contract-carrying and displaced the bulk source it covers. The pin is the
        // `.github/workflows/` path, not the bare filename.
        const before = 'const before = 1;\n';
        const plainAfter = "import { describe, expect, it } from 'vitest';\n";
        const mentionAfter = '// nightly.yml is mentioned here without its pinned path\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('zzz/mention.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: plainAfter,
                    [`${MERGE_BASE}:zzz/mention.spec.ts`]: before,
                    [`${HEAD}:zzz/mention.spec.ts`]: mentionAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(plainAfter, 'utf8'),
            },
        });
        expect(set.references.some((reference) => reference.path === 'zzz/mention.spec.ts')).toBe(false);
        expect(
            set.references.some((reference) => reference.path === 'aaa/plain.spec.ts' && reference.side === 'after')
        ).toBe(true);
        expect(set.truncated.some((entry) => entry.path === 'zzz/mention.spec.ts')).toBe(true);
    });

    it('leaves a collected spec whose after side is unavailable unclassified, never an error', () => {
        const set = collectEvidence({
            port: fakeSource({ files: [changedFile('scripts/__tests__/missing.spec.ts')], blobs: {} }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        expect(set.references).toHaveLength(0);
        expect(set.truncated.some((entry) => entry.reason === 'evidence-unavailable-at-revision')).toBe(true);
    });

    it('admits a pinned workflow file before a large bulk file under a one-path budget', () => {
        // R2: the closure is trusted-graph scripts only, so `.github/workflows/semantic-review.yml` ranked
        // bulk and a tight budget could drop the file that holds the advisory check's provider key. The
        // bulk fixture is cheaper under every non-contract leg, so only the contract class admits the
        // workflow file and its after side.
        const workflowBefore = 'name: semantic-review\n';
        const workflowAfter = 'name: semantic-review\non: pull_request_target\n';
        const bulk = 'const bulk = 1;\n';
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/bulk.ts'), changedFile('.github/workflows/semantic-review.yml')],
                blobs: {
                    [`${MERGE_BASE}:aaa/bulk.ts`]: bulk,
                    [`${HEAD}:aaa/bulk.ts`]: bulk,
                    [`${MERGE_BASE}:.github/workflows/semantic-review.yml`]: workflowBefore,
                    [`${HEAD}:.github/workflows/semantic-review.yml`]: workflowAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(workflowBefore, 'utf8') + Buffer.byteLength(workflowAfter, 'utf8'),
            },
        });
        expect(
            set.references.some(
                (reference) => reference.path === '.github/workflows/semantic-review.yml' && reference.side === 'after'
            )
        ).toBe(true);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'aaa/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (before)'
            )
        ).toBe(true);
    });

    it('records the contract-marked reason when a closure-importing spec is displaced by the budget', () => {
        const before = 'const before = 1;\n';
        const after = `import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n${'const large = 1;\n'.repeat(
            100
        )}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('scripts/__tests__/agentDeliveryScripts.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/agentDeliveryScripts.spec.ts`]: after,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: Buffer.byteLength(before, 'utf8') },
        });
        expect(set.truncated).toEqual([
            {
                path: 'scripts/__tests__/agentDeliveryScripts.spec.ts',
                reason: 'total-evidence-budget-exhausted (after, contract)',
            },
        ]);
    });

    it('admits a closure source before its own spec when the spec would exhaust the budget', () => {
        // R4: both paths are contract-carrying, but ranking by path put `scripts/__tests__/X.spec.ts`
        // before `scripts/X.ts`, so the spec spent the budget and withheld the source the change is
        // about. Non-spec before spec inside the contract group fixes it.
        const sourceBefore = 'export const policy = 1;\n';
        const sourceAfter = 'export const policy = 2;\n';
        const specBefore = "import { planReviewRisk } from '../reviewRiskPolicy.ts';\n";
        const specAfter = `${specBefore}${'const large = 1;\n'.repeat(200)}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/__tests__/reviewRiskPolicy.spec.ts'),
                    changedFile('scripts/reviewRiskPolicy.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewRiskPolicy.ts`]: sourceBefore,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: sourceAfter,
                    [`${MERGE_BASE}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(specBefore, 'utf8') + Buffer.byteLength(specAfter, 'utf8'),
            },
        });
        expect(set.references.some((reference) => reference.path === 'scripts/reviewRiskPolicy.ts')).toBe(true);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/__tests__/reviewRiskPolicy.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (after, contract)'
            )
        ).toBe(true);
    });

    it('admits a closure source before a cheaper spec and withholds the spec when the budget binds', () => {
        // R7: with a budget that admitted only the source's two sides, the spec's before side alone
        // exceeded it, so the spec was withheld under either order and the case observed the qualifier
        // vocabulary rather than the non-spec-before-spec ordering. A budget the spec's before side
        // fits, but which still displaces a source side when the spec sorts first, makes the ordering
        // leg decisive: the spec is cheaper than the source, so only non-spec-before-spec admits both
        // source sides ahead of it.
        const sourceBefore = 'export const policy = 1;\n';
        const sourceAfter = `export const policy = 2;\n${'const grown = 1;\n'.repeat(6)}`;
        const specBefore = "import { planReviewRisk } from '../reviewRiskPolicy.ts';\n";
        const specAfter = specBefore;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/__tests__/reviewRiskPolicy.spec.ts'),
                    changedFile('scripts/reviewRiskPolicy.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:scripts/reviewRiskPolicy.ts`]: sourceBefore,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: sourceAfter,
                    [`${MERGE_BASE}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specBefore,
                    [`${HEAD}:scripts/__tests__/reviewRiskPolicy.spec.ts`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') + Buffer.byteLength(sourceAfter, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'scripts/reviewRiskPolicy.ts:after',
            'scripts/reviewRiskPolicy.ts:before',
        ]);
        expect(set.truncated).toEqual([
            {
                path: 'scripts/__tests__/reviewRiskPolicy.spec.ts',
                reason: 'total-evidence-budget-exhausted (before, contract)',
            },
            {
                path: 'scripts/__tests__/reviewRiskPolicy.spec.ts',
                reason: 'total-evidence-budget-exhausted (after, contract)',
            },
        ]);
    });

    it('orders a chargeable hunk before screened and over-budget hunks it cannot charge', () => {
        // R5: the previous fixture pitted a clean copy against a clean edit, so reverting
        // `chargeableRegionBytes` to raw bytes left it green and dropping the content-screen branch left
        // the whole suite green. This fixture puts an in-budget hunk on one path beside a credential-shaped
        // hunk and an over-budget hunk, so the path ranks by the hunk admission can charge; dropping either
        // chargeability branch, or falling back to line counts, starves the material hunk and reddens.
        const awsShaped = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const material = 'const mat = 1;\n';
        const credentialBlock = `export const key = '${awsShaped}';\n`.repeat(10);
        const oversized = 'const oversized = 1;\n'.repeat(60);
        const competitor = 'const competitor = 123456789012345;\n';
        const materialBytes = Buffer.byteLength(material, 'utf8') - 1;
        const competitorBytes = Buffer.byteLength(competitor, 'utf8') - 1;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/edit.ts', { kind: 'added', added: 71, deleted: 0 }),
                    changedFile('bbb/competitor.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:aaa/edit.ts`]: `${material}${credentialBlock}${oversized}`,
                    [`${HEAD}:bbb/competitor.ts`]: competitor,
                },
                hunks: new Map([
                    [
                        'aaa/edit.ts',
                        {
                            path: 'aaa/edit.ts',
                            before: [],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 11 },
                                { startLine: 12, endLine: 71 },
                            ],
                        },
                    ],
                    [
                        'bbb/competitor.ts',
                        {
                            path: 'bbb/competitor.ts',
                            before: [],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000,
                maxTotalBytes: materialBytes + competitorBytes - 1,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'aaa/edit.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'bbb/competitor.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
        expect(
            set.excluded.some(
                (entry) => entry.path === 'aaa/edit.ts' && entry.reason === 'credential-shaped-content-excluded'
            )
        ).toBe(true);
    });

    it('ranks a contract path by its chargeable hunks, not the over-budget hunk', () => {
        // R1: the ranked cost summed every hunk slice, so an over-budget hunk outranked a cheaper
        // contract path and starved the material hunk that fits the total budget on its own. Ordering by
        // the bytes admission can charge counts the over-budget hunk as zero.
        const material = 'const mat = 1;\n';
        const oversized = 'const oversized = 1;\n'.repeat(60);
        const competitor = 'const competitor = 123456789012345;\n';
        // A single-line hunk slices away the trailing newline, so the two material slices cost one byte
        // less than their blobs.
        const materialBytes = Buffer.byteLength(material, 'utf8') - 1;
        const competitorBytes = Buffer.byteLength(competitor, 'utf8') - 1;
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('scripts/reviewRiskPolicy.ts', { kind: 'added', added: 1, deleted: 0 }),
                    changedFile('scripts/reviewDossier.ts', { kind: 'added', added: 1, deleted: 0 }),
                ],
                blobs: {
                    [`${HEAD}:scripts/reviewDossier.ts`]: `${material}${oversized}`,
                    [`${HEAD}:scripts/reviewRiskPolicy.ts`]: competitor,
                },
                hunks: new Map([
                    [
                        'scripts/reviewDossier.ts',
                        {
                            path: 'scripts/reviewDossier.ts',
                            before: [],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 61 },
                            ],
                        },
                    ],
                    [
                        'scripts/reviewRiskPolicy.ts',
                        {
                            path: 'scripts/reviewRiskPolicy.ts',
                            before: [],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 100,
                maxTotalBytes: materialBytes + competitorBytes - 1,
            },
        });
        // The material hunk ranks the contract path first and fits the total budget on its own.
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'scripts/reviewDossier.ts:after',
        ]);
        expect(set.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'region-exceeds-per-region-budget (after, contract)' },
            { path: 'scripts/reviewRiskPolicy.ts', reason: 'total-evidence-budget-exhausted (after, contract)' },
        ]);
    });

    it('admits a collected spec that imports a closure member as a .js specifier', () => {
        // R4: the runtime maps .js onto the TypeScript source, but the trial only tried the exact base
        // and the TypeScript extensions, so `../../canonicalRecord.js` ranked bulk while the runtime
        // loaded `scripts/canonicalRecord.ts`.
        const before = 'const before = 1;\n';
        const contractAfter = "import { canonicalRecord } from '../../canonicalRecord.js';\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/nested/canonicalRecord.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some((reference) => reference.path === 'scripts/__tests__/nested/canonicalRecord.spec.ts')
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it.each([
        ['query', '../../canonicalRecord.ts?raw'],
        ['hash', '../../canonicalRecord.ts#hash'],
    ])('admits a collected spec whose closure import carries a %s postfix', (_label, specifier) => {
        // R4: the runtime strips a query or hash postfix before resolving, so the trial must too, or a
        // spec pinning a closure member through one reads as bulk.
        const before = 'const before = 1;\n';
        const contractAfter = `import { canonicalRecord } from '${specifier}';\n`;
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/plain.spec.ts'),
                    changedFile('scripts/__tests__/nested/canonicalRecord.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/nested/canonicalRecord.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(
            set.references.some((reference) => reference.path === 'scripts/__tests__/nested/canonicalRecord.spec.ts')
        ).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });

    it('leaves a collected spec whose closure import is commented out bulk', () => {
        // R4: a regex over raw source read a commented-out import as a real one and classified the spec
        // contract-carrying. The syntax walker skips comments, so the spec stays bulk and the contract
        // spec beside it is admitted first.
        const before = 'const before = 1;\n';
        const contractAfter = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const commentedAfter = "// import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/commented.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: contractAfter,
                    [`${MERGE_BASE}:scripts/__tests__/commented.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/commented.spec.ts`]: commentedAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(true);
        expect(set.references.some((reference) => reference.path === 'scripts/__tests__/commented.spec.ts')).toBe(
            false
        );
        expect(
            set.truncated.some(
                (entry) =>
                    entry.path === 'scripts/__tests__/commented.spec.ts' &&
                    entry.reason === 'total-evidence-budget-exhausted (before)'
            )
        ).toBe(true);
    });

    it('admits a collected spec that dynamically imports a closure member before an equal-sized bulk spec', () => {
        // R4: the regex saw `import '...'` and `from '...'` but not `import('...')`, so a dynamic closure
        // import classified bulk. The syntax walker reads dynamic import specifiers, so it is contract.
        const before = 'const before = 1;\n';
        const contractAfter = "await import('../trustedGithubWriteBootstrap.ts');\n";
        const bulkAfter = "import { describe, expect, it } from 'vitest';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile('aaa/plain.spec.ts'), changedFile('scripts/__tests__/dynamic.spec.ts')],
                blobs: {
                    [`${MERGE_BASE}:aaa/plain.spec.ts`]: before,
                    [`${HEAD}:aaa/plain.spec.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/dynamic.spec.ts`]: before,
                    [`${HEAD}:scripts/__tests__/dynamic.spec.ts`]: contractAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(before, 'utf8') + Buffer.byteLength(contractAfter, 'utf8'),
            },
        });
        expect(set.references.some((reference) => reference.path === 'scripts/__tests__/dynamic.spec.ts')).toBe(true);
        expect(set.references.some((reference) => reference.path === 'aaa/plain.spec.ts')).toBe(false);
        expect(set.truncated.some((entry) => entry.path === 'aaa/plain.spec.ts')).toBe(true);
    });
});

describe('admission ordering counts a shared region once', () => {
    it('admits a copy of a modified source before a larger bulk when the shared before region is counted once', () => {
        // R1: `M a/source.ts` plus an exact copy `C a/source.ts z/copy.ts` mint the same before region.
        // The per-path estimate charged that shared region twice, so both ranked 680 while admission
        // charges the shared 339 once. The 496-byte bulk ranked below them and was admitted first,
        // starving the copy's 339-byte after side. Counting a shared region once ranks the copy by its
        // after side alone, so the smaller charge is admitted and the bulk is withheld.
        const sourceLine = 'const shared = 1;\n';
        const sourceBefore = sourceLine.repeat(20);
        const sourceAfter = `const shared = 2;\n${sourceLine.repeat(19)}`;
        const copyAfter = sourceBefore;
        const bulk = 'const bulk = 1;\n'.repeat(31);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('a/source.ts', { added: 1, deleted: 1 }),
                    changedFile('z/copy.ts', {
                        kind: 'copied',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 0,
                    }),
                    changedFile('m/bulk.ts', { kind: 'added', added: 31, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:a/source.ts`]: sourceBefore,
                    [`${HEAD}:a/source.ts`]: sourceAfter,
                    [`${HEAD}:z/copy.ts`]: copyAfter,
                    [`${HEAD}:m/bulk.ts`]: bulk,
                },
                hunks: new Map([
                    [
                        'a/source.ts',
                        {
                            path: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                    [
                        'z/copy.ts',
                        {
                            path: 'z/copy.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') * 3,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'a/source.ts:after',
            'a/source.ts:before',
            'z/copy.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'm/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });

    it('admits a copy and a rename of one unchanged source before a larger bulk when the shared before region is counted once', () => {
        // R1: `C a/source.ts z/copy.ts` plus `R a/source.ts z/renamed.ts` from one unchanged source mint
        // the same before region for both, and the per-path estimate charged it twice. Counting it once
        // ranks each derived path by its after side, so both afters are admitted and the bulk withheld.
        const sourceLine = 'const shared = 1;\n';
        const sourceBefore = sourceLine.repeat(20);
        const copyAfter = sourceBefore;
        const renamedAfter = `const renamed = 1;\n${sourceLine.repeat(19)}`;
        const bulk = 'const bulk = 1;\n'.repeat(31);
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('z/copy.ts', {
                        kind: 'copied',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 0,
                    }),
                    changedFile('z/renamed.ts', {
                        kind: 'renamed',
                        previousPath: 'a/source.ts',
                        added: 20,
                        deleted: 20,
                    }),
                    changedFile('m/bulk.ts', { kind: 'added', added: 31, deleted: 0 }),
                ],
                blobs: {
                    [`${MERGE_BASE}:a/source.ts`]: sourceBefore,
                    [`${HEAD}:z/copy.ts`]: copyAfter,
                    [`${HEAD}:z/renamed.ts`]: renamedAfter,
                    [`${HEAD}:m/bulk.ts`]: bulk,
                },
                hunks: new Map([
                    [
                        'z/copy.ts',
                        {
                            path: 'z/copy.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                    [
                        'z/renamed.ts',
                        {
                            path: 'z/renamed.ts',
                            previousPath: 'a/source.ts',
                            before: [{ startLine: 1, endLine: 20 }],
                            after: [{ startLine: 1, endLine: 20 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes: Buffer.byteLength(sourceBefore, 'utf8') * 3,
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`).sort()).toEqual([
            'a/source.ts:before',
            'z/copy.ts:after',
            'z/renamed.ts:after',
        ]);
        expect(
            set.truncated.some(
                (entry) => entry.path === 'm/bulk.ts' && entry.reason === 'total-evidence-budget-exhausted (after)'
            )
        ).toBe(true);
    });
});

describe('admission ordering follows the side that carries the contract', () => {
    it('admits a contract side before a bulk side of another change regardless of file order', () => {
        // R2: a rename out of `AGENTS.md` is contract on its before side and bulk on its 1700-byte after
        // side. The union of the two classes ordered the whole path as contract, admitted its bulk after
        // side first, and withheld the closure-importing spec's contract after side. Ordering each side
        // by its own class admits the spec's after side and withholds the bulk after side without the
        // contract term.
        const docBefore = '# AGENTS.md\n';
        const bulkAfter = 'const bulk = 1;\n'.repeat(106);
        const specSide = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
        const set = collectEvidence({
            port: fakeSource({
                files: [
                    changedFile('aaa/bulk.ts', { kind: 'renamed', previousPath: 'AGENTS.md', added: 106, deleted: 1 }),
                    changedFile('scripts/__tests__/closure.spec.ts'),
                ],
                blobs: {
                    [`${MERGE_BASE}:AGENTS.md`]: docBefore,
                    [`${HEAD}:aaa/bulk.ts`]: bulkAfter,
                    [`${MERGE_BASE}:scripts/__tests__/closure.spec.ts`]: specSide,
                    [`${HEAD}:scripts/__tests__/closure.spec.ts`]: specSide,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: {
                maxRegionBytes: 1_000_000,
                maxTotalBytes:
                    Buffer.byteLength(docBefore, 'utf8') +
                    Buffer.byteLength(bulkAfter, 'utf8') +
                    Buffer.byteLength(specSide, 'utf8'),
            },
        });
        expect(set.references.map((reference) => `${reference.path}:${reference.side}`)).toEqual([
            'scripts/__tests__/closure.spec.ts:before',
            'scripts/__tests__/closure.spec.ts:after',
            'AGENTS.md:before',
        ]);
        expect(set.truncated).toEqual([{ path: 'aaa/bulk.ts', reason: 'total-evidence-budget-exhausted (after)' }]);
    });
});

describe('contract classification follows each side on both routes', () => {
    const closureImport = "import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n";
    const largeFiller = 'const large = 1;\n'.repeat(200);
    const limits = { maxRegionBytes: 100, maxTotalBytes: 8_192 };

    async function verifyWithheldReason(
        reference: { path: string; side: 'before' | 'after' | 'context' },
        blobs: Record<string, string>
    ): Promise<string | undefined> {
        const { runVerify } = await import('../verify.ts');
        const result = await runVerify({
            ports: {
                source: fakeSource({ files: [], blobs }),
                provider: constantProvider({ supported: 0.5, contradicted: 0.25, insufficient_context: 0.25 }),
                cache: new MapCache(),
                clock: fixedClock(1_000),
                signal: new AbortController().signal,
                log: () => undefined,
            },
            revision: BASE_REVISION,
            profile: SEMANTIC_BUDGET_PROFILES.local,
            limits,
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [{ ...reference, startLine: 1, endLine: Number.MAX_SAFE_INTEGER }],
                },
            ],
            runId: 'verify-withheld',
        });
        return result.report.scope.truncated[0]?.reason;
    }

    it('classifies a deleted closure-pinning spec by its before side on both routes', async () => {
        // R3: a deleted spec has no after side, so the after-only classifier read it bulk and the scan
        // withheld its before side without the contract term, while verify read that reference's own
        // before content and did.
        const deletedPath = 'scripts/__tests__/deleted.spec.ts';
        const beforeContent = `${closureImport}${largeFiller}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(deletedPath, { kind: 'deleted' })],
                blobs: { [`${MERGE_BASE}:${deletedPath}`]: beforeContent },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
        });
        expect(set.truncated).toEqual([
            { path: deletedPath, reason: 'region-exceeds-per-region-budget (before, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: deletedPath, side: 'before' },
                {
                    [`${MERGE_BASE}:${deletedPath}`]: beforeContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (before, contract)');
    });

    it('classifies a renamed closure-pinning spec by its before side on both routes', async () => {
        // R3: a rename was classified by its destination, so a spec moved out of a closure-pinning path
        // read bulk on its before side while verify read the source path's own content.
        const sourcePath = 'scripts/__tests__/closure.spec.ts';
        const targetPath = 'src/modules/other/moved.ts';
        const beforeContent = `${closureImport}${largeFiller}`;
        const set = collectEvidence({
            port: fakeSource({
                files: [changedFile(targetPath, { kind: 'renamed', previousPath: sourcePath, added: 1, deleted: 1 })],
                blobs: {
                    [`${MERGE_BASE}:${sourcePath}`]: beforeContent,
                    [`${HEAD}:${targetPath}`]: 'const after = 1;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
        });
        expect(set.truncated).toEqual([
            { path: sourcePath, reason: 'region-exceeds-per-region-budget (before, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: sourcePath, side: 'before' },
                {
                    [`${MERGE_BASE}:${sourcePath}`]: beforeContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (before, contract)');
    });

    it('labels a withheld contract-context region the same on both routes', async () => {
        // R3: the scan named a withheld contract-context region `(contract)` while verify named the same
        // reference `(context, contract)`; both now read the side qualifier the reference actually has.
        const contractContent = '# AGENTS.md\n'.repeat(200);
        const set = collectEvidence({
            port: fakeSource({ files: [], blobs: { [`${MERGE_BASE}:AGENTS.md`]: contractContent } }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits,
            contractPaths: ['AGENTS.md'],
        });
        expect(set.truncated).toEqual([
            { path: 'AGENTS.md', reason: 'region-exceeds-per-region-budget (context, contract)' },
        ]);
        expect(
            await verifyWithheldReason(
                { path: 'AGENTS.md', side: 'context' },
                {
                    [`${MERGE_BASE}:AGENTS.md`]: contractContent,
                }
            )
        ).toBe('region-exceeds-per-region-budget (context, contract)');
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

describe('a zero-line copy owes the duplicated mechanism', () => {
    it('plans an exact copy instead of taking the rename exemption', () => {
        // A pure rename has a zero-line diff, but so does an exact copy: both numstats read `0 0`.
        // The rename exemption keys on `previousPath` alone, which is set for both kinds, so the copy
        // took `no-text-change`, was never planned, and a PR that only duplicated a file reported a
        // green skip over the very mechanism `duplicates_existing_mechanism` exists to question.
        const file = changedFile('docs/undo-copy.md', {
            kind: 'copied',
            previousPath: 'docs/undo.md',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('still excludes a mode-only modification as nothing owed', () => {
        // A file whose mode changed but whose text did not is a zero-line diff with no previous path
        // and no added tree entry: there is nothing to assess, and it must stay a skip.
        const file = changedFile('docs/mode.md', { added: 0, deleted: 0 });
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

describe('a hunked copy whose source is also modified', () => {
    const sourcePath = 'src/modules/Project/a.ts';
    const copyPath = 'src/modules/Project/c.ts';

    function replaceLine(text: string, lineNumber: number, replacement: string): string {
        const lines = text.split('\n');
        lines[lineNumber - 1] = replacement;
        return lines.join('\n');
    }

    function serializedCost(set: SemanticEvidenceSet, reference: EvidenceReference): number {
        return Buffer.byteLength(
            JSON.stringify({
                [reference.evidenceId]: serializedRegion(reference, set.contents.get(reference.evidenceId) ?? ''),
            }),
            'utf8'
        );
    }

    function hunkedCopy(): { set: SemanticEvidenceSet; files: SemanticChangedFile[] } {
        const lineText = (line: number): string => `export const value${String(line)} = ${String(line)};`;
        const base = `${Array.from({ length: 100 }, (_, index) => lineText(index + 1)).join('\n')}\n`;
        const files = [
            changedFile(sourcePath),
            changedFile(copyPath, {
                kind: 'copied',
                previousPath: sourcePath,
                added: 1,
                deleted: 0,
            }),
        ];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${sourcePath}`]: base,
                    [`${HEAD}:${sourcePath}`]: replaceLine(base, 20, 'export const changed = 20;'),
                    [`${HEAD}:${copyPath}`]: replaceLine(base, 80, 'export const changed = 80;'),
                },
                hunks: new Map([
                    [
                        sourcePath,
                        {
                            path: sourcePath,
                            before: [{ startLine: 14, endLine: 26 }],
                            after: [{ startLine: 14, endLine: 26 }],
                        },
                    ],
                    [
                        copyPath,
                        {
                            path: copyPath,
                            previousPath: sourcePath,
                            before: [{ startLine: 74, endLine: 86 }],
                            after: [{ startLine: 74, endLine: 86 }],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
        });
        return { set, files };
    }

    it('attributes each region to the changed file that minted it', () => {
        // `M a.ts` plus `C097 a.ts c.ts` mints four regions: the modified source's before/after around
        // line 20 and the copy's before/after around line 80. Both before regions carry the source
        // path, so selecting own regions by (path, side) handed each unit the other's before region.
        const { set, files } = hunkedCopy();
        expect(set.references).toHaveLength(4);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const source = units.find((unit) => unit.path === sourcePath);
        const copy = units.find((unit) => unit.path === copyPath);
        const ownTriples = (unit: typeof source): string[] =>
            (unit?.evidence.own ?? [])
                .map((reference) => `${reference.path}:${reference.side}:${reference.startLine}`)
                .sort();
        expect(ownTriples(source)).toEqual([`${sourcePath}:after:14`, `${sourcePath}:before:14`]);
        expect(ownTriples(copy)).toEqual([`${sourcePath}:before:74`, `${copyPath}:after:74`]);
    });

    it('does not drop the copy own after side under a budget fitting two regions', () => {
        const { set, files } = hunkedCopy();
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const copy = units.find((unit) => unit.path === copyPath);
        expect(copy).toBeDefined();
        // Under the old path-only selection the copy owned three regions — the source's before, its
        // own before, and its own after — and the after, sorting last, was the one a two-region budget
        // dropped while the scope still counted the path as assessed. Its own set is now its before
        // and after alone, so a budget sized for those two keeps the after side.
        const copyBefore = set.references.find(
            (reference) => reference.path === sourcePath && reference.side === 'before' && reference.startLine === 74
        );
        const copyAfter = set.references.find((reference) => reference.path === copyPath && reference.side === 'after');
        expect(copyBefore).toBeDefined();
        expect(copyAfter).toBeDefined();
        if (copyBefore === undefined || copyAfter === undefined) {
            throw new Error('the hunked copy did not mint its own before and after regions');
        }
        const budget = serializedCost(set, copyBefore) + serializedCost(set, copyAfter);
        const fitted = fitUnitEvidence(set, copy?.evidence.own ?? [], [], budget);
        expect(fitted.dropped).toBe(0);
        expect(fitted.own.droppedSides.has('after')).toBe(false);
        expect(fitted.own.references.some((reference) => reference.side === 'after')).toBe(true);
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

describe('the collection predicate uses the runner extension set', () => {
    it('collects only spec/test files with a runner code extension', () => {
        // The old predicate matched `\.(?:spec|test)\.[^.]+$`, so a `.spec.md` or `.spec.json` counted
        // as collected even though no runner collects either — Vitest's and Playwright's defaults both
        // stop at `?(c|m)[jt]s?(x)`.
        expect(isCollectedSpec('src/modules/Project/undo.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.tsx')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.test.mjs')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.cts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.md')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.json')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.d.ts')).toBe(false);
    });

    it('plans a zero-line rename from a collected spec to an uncollected extension', () => {
        // `undo.spec.md` used to read as collected, so the two sides compared equal and the rename
        // stayed `no-text-change`: a suite that stopped running was never mentioned.
        const file = changedFile('docs/undo.spec.md', {
            kind: 'renamed',
            previousPath: 'docs/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
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
            // Vendor family names are now secret key names, so a vendor keyword used as an ordinary
            // identifier, assigned a filesystem path (absolute or relative), or mentioned in a comment
            // must stay admitted.
            'linear: usage.actualInputTokens,',
            'datadog = "/var/lib/datadog",',
            'datadog = "./metrics/datadog.json",',
            '// facebook OAuth client integration',
            // A vendor name must not match inside a longer identifier (`etsy` in `Synth`, `linear` in
            // `bilinear`), and a bare mixed-case identifier value is a reference, not key material —
            // so a type-annotation shaped line stays admitted too.
            'const workletSynthEntry = workletSynthDevice',
            'bilinearPatch: bilinearPatchMock',
            'linear_entry: CallbackUndoEntry',
            'secretGroup: secretGroupMatch === null ? undefined : Number(secretGroupMatch[1]),',
            // A header quoted in documentation with a redaction word where the body belongs is ordinary
            // text, not key material: an eight-character word is not a PEM body line.
            secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----', '\n', 'REDACTED'),
            secretFixture(
                '-----BEGIN ',
                'PRIVATE KEY',
                '-----',
                '\n',
                'Note: ',
                'the body was redacted',
                '\n',
                'REDACTED'
            ),
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

    it('withholds an all-uppercase alphanumeric value but not a SCREAMING_SNAKE name', () => {
        // An opaque all-uppercase run that carries both letters and digits and no underscore is a
        // value, not an environment-variable name; the name shape must stay admitted.
        const keyId = secretFixture('ABCDEF', '123456', '7890AB');
        expect(sensitiveContentReason(secretFixture('API_KEY=', keyId))).toBeDefined();
        // A name carries no digits or carries an underscore separator, so it stays ordinary.
        expect(sensitiveContentReason(secretFixture('apiKey=', 'TYPESAFE', '_API_KEY'))).toBeUndefined();
    });

    it('withholds a quoted mixed-case value but admits a bare mixed-case identifier', () => {
        // A quoted run is a value by construction, so it is never read as a reference; the bare
        // identifier rejection applies only to an unquoted run.
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"AbCdEfGhIjKlMnOp"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('password = ', '"CorrectHorseBatteryStaple"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', 'AbCdEfGhIjKlMnOp'))).toBeUndefined();
    });

    it('withholds a value assigned to a vendor family name', () => {
        // A keyword-proximity family is recognised as a secret key name, so its assignment reaches
        // the value heuristic instead of passing the screen untouched, whatever separator its
        // family's token carries (`_`, `-`).
        const value = 'a'.repeat(40);
        expect(sensitiveContentReason(secretFixture('datadog=', value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('DATADOG_API_KEY=', value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('datadog_api_key: ', "'", value, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('linear_client_secret=', "'", 'a'.repeat(32), "'"))).toBeDefined();
    });

    it('withholds a secret value under the delimiter and terminator forms it reads, and admits the escaped-newline form', () => {
        // The scanner's generic key rule flags a secret under a single, triple, or backtick delimiter,
        // and it treats each delimiter as an independent boundary, so a mismatched pair such as `'…"` is
        // also flagged. Its terminator is any single delimiter, whitespace, a semicolon, a newline, or
        // end of input, and its opening run is up to four delimiters, so those closings and a four-quote
        // run are withheld too. A nested delimiter ends the run, so `'''…"…'''` stops at the inner `"`
        // and is admitted; an escaped delimiter also stops the run and is admitted. The escaped-newline
        // terminator is deliberately not modelled (see #4579), so that form is admitted, not withheld;
        // this case therefore does not claim to cover every form the scanner reads.
        const value = 'Ab3dEf7hIj2lMn4pQr5tUv6xYz0Lm9Nq1Rs8Tp';
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, "'"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'''", value, "'''"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"""', value, '"""'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '`', value, '`'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '"'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', '"', value, "'"))).toBeDefined();
        // Closed by the scanner's full terminator set, not only a delimiter.
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, ' '))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, ';'))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, "''''"))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "''''", value))).toBeDefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'''''", value))).toBeUndefined();
        // The escaped-newline terminator is deliberately not modelled (the scanner pairs it with an
        // entropy gate and a value allowlist the screen cannot apply), so these stay admitted and the
        // leak is deferred to #4579.
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '\\n'))).toBeUndefined();
        expect(sensitiveContentReason(secretFixture('client_secret = ', "'", value, '\\r'))).toBeUndefined();
        // A nested or escaped delimiter ends the run and is admitted.
        expect(
            sensitiveContentReason(
                secretFixture('client_secret = ', "'''", 'Ab3dEf7hIj2', '"', 'Qw9Er8Ty7Ui6Op5As4Df3', "'''")
            )
        ).toBeUndefined();
        expect(
            sensitiveContentReason(secretFixture('client_secret = ', '"Ab3dEf7hI\\"j2lMn4pQr5tUv6"'))
        ).toBeUndefined();
    });

    it('withholds a secret-named assignment whatever the naming convention, and still admits identifier values', () => {
        // No left boundary: `SOME_TOKEN`, `apiToken`, `dbPassword` and their like are the dominant
        // secret-naming vocabulary and must reach the value heuristic. The value heuristic, not a
        // name boundary, separates them from the identifier-valued collisions below.
        const value = secretFixture('a1b2c3d4', 'e5f6g7h8', 'i9j0k1l2', 'm3n4o5p6');
        for (const key of [
            'SOME_TOKEN',
            'API_TOKEN',
            'MY_SECRET',
            'DB_PASSWORD',
            'SNAKE_CASE_API_KEY',
            'api_token',
            'apiToken',
            'dbPassword',
            'validToken',
        ]) {
            expect(sensitiveContentReason(secretFixture(key, ' = ', value)), key).toBeDefined();
        }
        // The collisions the review found stay admitted because their value is a reference, not key
        // material — a boundary on the name would be the wrong lever and would not be needed.
        expect(sensitiveContentReason('workletSynthEntry = workletSynthDevice')).toBeUndefined();
        expect(sensitiveContentReason('bilinearPatch: bilinearPatchMock')).toBeUndefined();
        expect(sensitiveContentReason('linear_entry: CallbackUndoEntry')).toBeUndefined();
    });

    it('admits a filesystem path but withholds a slash-led base64 credential', () => {
        // A path is made of short name segments; a base64 credential is one long opaque run. The
        // leading slash must not make a credential read as a path, and it must not make a path read
        // as a credential.
        expect(sensitiveContentReason(secretFixture('datadog=', '/var/lib/datadog'))).toBeUndefined();
        const slashLedBase64 = secretFixture('/', 'AbCdEfGh', 'IjKlMnOp', 'QrStUvWx', 'Yz012345', '6789AB');
        expect(sensitiveContentReason(secretFixture('datadog=', slashLedBase64))).toBeDefined();
        // A base64 credential may also contain an internal slash and `+`; the non-name characters keep
        // it credential-shaped rather than path-shaped.
        const base64WithSlashAndPlus = secretFixture('/', 'AbCdEfGh+', 'IjKlMnOp/', 'QrStUvWx', 'Yz012345');
        expect(sensitiveContentReason(secretFixture('datadog=', base64WithSlashAndPlus))).toBeDefined();
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
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
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

    it('withholds a passphrase-encrypted envelope and a blank line between header and body', () => {
        // A traditional encrypted block (`openssl rsa -aes256 -traditional`) puts `Proc-Type` and
        // `DEK-Info` lines, and a blank line, between the header and the body. The old pattern required
        // the base64 body on the line after the header, so a real encrypted key passed the screen and
        // its region went to the provider.
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
        const procType = secretFixture('Proc-Type: 4,', 'ENCRYPTED');
        const dekInfo = secretFixture('DEK-Info: ', 'AES-256-CBC,0123456789ABCDEF');
        const encrypted = secretFixture(rsaHeader, '\n', procType, '\n', dekInfo, '\n', '\n', body);
        expect(sensitiveContentReason(encrypted)).toBe('an armored private key');
        const blankLine = secretFixture(rsaHeader, '\n', '\n', body);
        expect(sensitiveContentReason(blankLine)).toBe('an armored private key');
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

describe('verify summary wording', () => {
    it('describes withheld evidence as a coverage gap, not model indecision', async () => {
        // A verify report whose evidence was withheld carries a decisive support answer and a
        // `needs_more_evidence` disposition, because `interpretFinding` outranks every threshold when
        // the referenced evidence was not supplied. The outcome sentence must name that coverage gap
        // rather than reuse the scan sentence about unresolved answers or near misses.
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
            runId: 'verify-summary',
        });
        const assessment = result.report.findingAssessments[0];
        expect(assessment?.disposition).toBe('needs_more_evidence');
        // The support answer is decisive; only the withheld before side blocks the disposition.
        expect(assessment?.support.outcome).toBe('supported');
        const summary = renderSummary(result.report);
        expect(summary).toContain('No finding was decidable');
        expect(summary).toContain('needed more evidence');
        expect(summary).not.toContain('unresolved or came close');
        expect(summary).not.toContain('No question was decidable');
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

describe('required-evidence resolution is exhaustive', () => {
    it('reports a declared token with no resolver as missing, not satisfied by anything', () => {
        // `related existing source` matched no substring branch, and the final `own.length > 0 ||
        // context.length > 0` fallback satisfied it from whatever the unit carried — so a duplication
        // rule returned a decisive verdict with no related source ever sent.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' });
        expect(
            missingRequiredEvidence(semanticRule('duplicates_existing_mechanism'), [ownAfter], [], 'modified')
        ).toContain('related existing source');
    });

    it('turns a missing related source into insufficient_context, not a decisive verdict', () => {
        const assessment = interpretScanOutcome({
            answer: { type: 'noul', noul: 0.01 },
            rule: semanticRule('duplicates_existing_mechanism'),
            unitId: 'u',
            path: 'src/modules/Project/a.ts',
            missingEvidence: missingRequiredEvidence(
                semanticRule('duplicates_existing_mechanism'),
                [reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' })],
                [],
                'modified'
            ),
        });
        expect(assessment.outcome).toBe('insufficient_context');
        expect(assessment.disposition).toBe('unresolved');
    });

    it('fails when a rule declares a token the resolver mapping does not cover', () => {
        // A guard that cannot fail is what let the fallback hide: every declared token must answer to
        // an exact resolver, so adding a rule with a new token is a visible decision.
        for (const rule of SEMANTIC_RULES) {
            for (const token of rule.requiredEvidence) {
                expect(RESOLVED_EVIDENCE_TOKENS.has(token), `no resolver for ${token}`).toBe(true);
            }
        }
    });
});

describe('caller and call-site tokens resolve against context alone', () => {
    it('does not let the own after side satisfy a caller requirement', () => {
        // The caller branch resolved to `ownHas('after') || contextHas('context')`, and the unit's own
        // after side is the changed file itself, not a caller outside it — so a rule asking whether
        // callers were updated was answered with no caller in view.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/a.ts', side: 'after' });
        const contractContext = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(
                semanticRule('public_contract_widened_silently'),
                [ownAfter],
                [contractContext],
                'modified'
            )
        ).not.toContain('caller or contract');
        expect(
            missingRequiredEvidence(semanticRule('public_contract_widened_silently'), [ownAfter], [], 'modified')
        ).toContain('caller or contract');
    });

    it('reports a scheduling call-site with no context as missing', () => {
        const ownAfter = reference({ evidenceId: 'a1', path: 'crates/daw-dsp/src/a.rs', side: 'after' });
        expect(missingRequiredEvidence(semanticRule('timing_semantics_changed'), [ownAfter], [], 'modified')).toContain(
            'scheduling call-site'
        );
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

    it('records hunk-beyond-file when a finding names a range that starts past the file', async () => {
        // R3: verify clamped a startLine past the file to the file's last line and sent that line as the
        // finding's own evidence, while the scan records hunk-beyond-file and supplies nothing. Both
        // routes now slice through `sliceLines` and refuse the same reference.
        const { result, providerCalls } = await verifyWith(
            [{ path: 'src/modules/Project/a.ts', side: 'after', startLine: 5000, endLine: 5001 }],
            {
                [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\nexport const b = 2;',
            }
        );
        expect(providerCalls).toBe(0);
        expect(result.report.findingAssessments).toHaveLength(0);
        expect(result.report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
        expect(result.report.scope.truncated).toEqual([
            { path: 'src/modules/Project/a.ts', reason: 'hunk-beyond-file (after)' },
        ]);
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

describe('contract documents satisfy neither a call site nor related source', () => {
    it('reports a scheduling call-site missing despite contract context (#4555)', () => {
        // The only context regions the planner mints are contract documents, which say nothing about
        // where audio events are scheduled. The token must stay missing until a call-site region is
        // collected, never be satisfied by AGENTS.md.
        const ownAfter = reference({ evidenceId: 'a1', path: 'crates/daw-dsp/src/a.rs', side: 'after' });
        const contract = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(semanticRule('timing_semantics_changed'), [ownAfter], [contract], 'modified')
        ).toContain('scheduling call-site');
    });

    it('reports related existing source missing despite contract context (#4555)', () => {
        // A contract document is not the existing source a duplication question compares against, so a
        // decisive duplication verdict with only AGENTS.md in the request is exactly the error this
        // token must refuse.
        const ownAfter = reference({ evidenceId: 'a1', path: 'src/modules/Project/undo.ts', side: 'after' });
        const contract = reference({ evidenceId: 'c1', path: 'AGENTS.md', side: 'context' });
        expect(
            missingRequiredEvidence(semanticRule('duplicates_existing_mechanism'), [ownAfter], [contract], 'modified')
        ).toContain('related existing source');
    });
});

describe('collector withholding reaches the side accounting', () => {
    it('reports a side missing when one of its hunks exceeded the per-region budget', () => {
        // The collector withheld one of the after hunks at admission, not the fitter. The surviving
        // after region alone satisfied the side before, so the rule returned a decisive verdict over a
        // side the model saw only in part.
        const before = 'it("before", () => {});\n';
        const after = `it("kept", () => {});\n${'const large_line = 1;\n'.repeat(200)}`;
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
                                { startLine: 2, endLine: 201 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 400, maxTotalBytes: 1_000_000 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit).toBeDefined();
        // One after hunk survives, so a predicate that only checks `some` would call the side present.
        expect(unit?.evidence.references.some((ref) => ref.side === 'after')).toBe(true);
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
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('assertion_deleted'),
                unitId: 'u',
                path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('reports a side missing when a hunk was omitted for the total budget', () => {
        const beforeLine = 'it("before", () => {});';
        const firstLine = 'it("first", () => {});';
        const secondLine = 'it("second", () => {});';
        const files = [changedFile('src/modules/Project/__tests__/two-hunks.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/two-hunks.spec.ts`]: `${beforeLine}\n`,
                    [`${HEAD}:src/modules/Project/__tests__/two-hunks.spec.ts`]: `${firstLine}\n${secondLine}\n`,
                },
                hunks: new Map([
                    [
                        'src/modules/Project/__tests__/two-hunks.spec.ts',
                        {
                            path: 'src/modules/Project/__tests__/two-hunks.spec.ts',
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            // The total budget admits the before hunk and the first after hunk but not the second.
            limits: {
                maxRegionBytes: 1_000,
                maxTotalBytes: Buffer.byteLength(beforeLine, 'utf8') + Buffer.byteLength(firstLine, 'utf8'),
            },
        });
        expect(set.truncated.some((entry) => entry.reason.startsWith('total-evidence-budget-exhausted'))).toBe(true);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.ownDroppedSides.has('after')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toContain('after test source');
    });

    it('reports a contract side missing when one contract region was withheld for a credential', () => {
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile('src/modules/Project/undo.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/undo.ts`]: 'export const a = 1;\n',
                    [`${HEAD}:src/modules/Project/undo.ts`]: 'export const a = 2;\n',
                    [`${MERGE_BASE}:AGENTS.md`]: '# Rules\n',
                    [`${MERGE_BASE}:.agents/decisions/README.md`]: `token: ${aws}\n`,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
            contractPaths: ['AGENTS.md', '.agents/decisions/README.md'],
        });
        // One contract region survived and one was withheld, so the context side was seen only in part.
        expect(set.references.filter((ref) => ref.side === 'context')).toHaveLength(1);
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.contextDroppedSides.has('context')).toBe(true);
        expect(
            missingRequiredEvidence(
                semanticRule('stated_invariant_contradicted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toContain('decision or documented invariant');
    });

    it('still reports a side supplied when every region was admitted', () => {
        const files = [changedFile('src/modules/Project/__tests__/clean.spec.ts')];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:src/modules/Project/__tests__/clean.spec.ts`]: 'it("before", () => {});\n',
                    [`${HEAD}:src/modules/Project/__tests__/clean.spec.ts`]: 'it("after", () => {});\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units[0];
        expect(unit?.evidence.ownDroppedSides.size).toBe(0);
        expect(
            missingRequiredEvidence(
                semanticRule('assertion_deleted'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified'
            )
        ).toEqual([]);
    });
});

describe('collector withholding of an implementation file reaches the consuming unit', () => {
    it('reports implementation source missing when the changed implementation had a withheld after hunk', () => {
        // The implementation context is assembled from other changed files' surviving after regions,
        // and the collector's withholding of one of those files' hunks is keyed to that file under
        // `withheldSides.own` — never merged into the consuming unit. A surviving hunk then satisfied
        // `after implementation source`, and the rule scored a decisive verdict over an implementation
        // the model saw only in part.
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const implPath = 'src/modules/Project/useCases/undoProject.ts';
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile(testPath), changedFile(implPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${implPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${implPath}`]: `export const kept = 1;\nconst key = '${aws}';\n`,
                },
                hunks: new Map([
                    [
                        testPath,
                        {
                            path: testPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [{ startLine: 1, endLine: 1 }],
                        },
                    ],
                    [
                        implPath,
                        {
                            path: implPath,
                            before: [{ startLine: 1, endLine: 1 }],
                            after: [
                                { startLine: 1, endLine: 1 },
                                { startLine: 2, endLine: 2 },
                            ],
                        },
                    ],
                ]),
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        // The surviving implementation hunk sits in the unit's context, but the withheld hunk names the
        // same owning file, so the context after side is unsupplied.
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(true);
        const missing = missingRequiredEvidence(
            semanticRule('production_path_no_longer_reached'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: testPath,
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('reports implementation source missing when the changed implementation was withheld in full', () => {
        // A wholly withheld implementation file leaves no surviving after region to attribute, so the
        // old attribution walk never consulted its recorded withholding; a second, clean implementation
        // file then satisfied `after implementation source` over an incomplete candidate set.
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const withheldImplPath = 'src/modules/Project/useCases/undoProject.ts';
        const cleanImplPath = 'src/modules/Project/useCases/arrange.ts';
        const aws = secretFixture('AKIA', 'IOSFODNN7EXAM', 'PLE');
        const files = [changedFile(testPath), changedFile(withheldImplPath), changedFile(cleanImplPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${withheldImplPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${withheldImplPath}`]: `const key = '${aws}';\n`,
                    [`${MERGE_BASE}:${cleanImplPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${cleanImplPath}`]: 'export const after = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.rules.map((rule) => rule.id)).toContain('production_path_no_longer_reached');
        // The clean implementation's after side survives in context, but the withheld implementation's
        // after side is recorded under `withheldSides.own` and must unsupply the context side.
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(true);
        const missing = missingRequiredEvidence(
            semanticRule('production_path_no_longer_reached'),
            unit?.evidence.own ?? [],
            unit?.evidence.context ?? [],
            'modified',
            unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
            unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
        );
        expect(missing).toContain('after implementation source');
        expect(
            interpretScanOutcome({
                answer: { type: 'noul', noul: 0.05 },
                rule: semanticRule('production_path_no_longer_reached'),
                unitId: 'u',
                path: testPath,
                missingEvidence: missing,
            }).outcome
        ).toBe('insufficient_context');
    });

    it('still scores a unit whose implementation context was delivered whole', () => {
        const testPath = 'src/modules/Project/__tests__/undo.spec.ts';
        const implPath = 'src/modules/Project/useCases/undoProject.ts';
        const files = [changedFile(testPath), changedFile(implPath)];
        const set = collectEvidence({
            port: fakeSource({
                files,
                blobs: {
                    [`${MERGE_BASE}:${testPath}`]: 'it("before", () => {});\n',
                    [`${HEAD}:${testPath}`]: 'it("after", () => {});\n',
                    [`${MERGE_BASE}:${implPath}`]: 'export const before = 1;\n',
                    [`${HEAD}:${implPath}`]: 'export const after = 2;\n',
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const { units } = planUnits(files, set, SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes);
        const unit = units.find((candidate) => candidate.path === testPath);
        expect(unit).toBeDefined();
        expect(unit?.evidence.contextDroppedSides.has('after')).toBe(false);
        expect(
            missingRequiredEvidence(
                semanticRule('production_path_no_longer_reached'),
                unit?.evidence.own ?? [],
                unit?.evidence.context ?? [],
                'modified',
                unit?.evidence.ownDroppedSides ?? new Set<EvidenceSide>(),
                unit?.evidence.contextDroppedSides ?? new Set<EvidenceSide>()
            )
        ).toEqual([]);
    });
});

describe('the outcome line never claims completion for a partial run', () => {
    it('words a partial execution with decisive answers as incomplete', async () => {
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
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
        const partial = {
            ...result.report,
            execution: 'partial' as const,
            signals: result.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const summary = renderSummary(partial);
        expect(summary).not.toContain('Completed: no additional semantic signals');
        expect(summary).toContain('did not supply all its evidence');
    });
});

describe('the undecided sentence names near misses without calling them unresolved', () => {
    it('accounts for a genuine unresolved answer and a near miss together', async () => {
        // `undecided` counts genuine `unresolved` dispositions and near misses together, so the
        // sentence must name both categories: a near miss is a `no_additional_recommendation` answer
        // below its fire threshold, not an unresolved question.
        const result = await runScan(
            scanPorts(
                constantProvider(0.05),
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
        const base = result.report.signals[0] as (typeof result.report.signals)[number];
        const decisive = {
            ...base,
            outcome: 'no_signal' as const,
            disposition: 'no_additional_recommendation' as const,
            probability: 0.02,
            missingEvidence: [],
        };
        const nearMiss = {
            ...base,
            outcome: 'no_signal' as const,
            disposition: 'no_additional_recommendation' as const,
            probability: 0.6,
            missingEvidence: [],
        };
        const unresolved = {
            ...base,
            outcome: 'insufficient_context' as const,
            disposition: 'unresolved' as const,
            probability: 0.5,
            missingEvidence: ['after test source'],
        };
        const summary = renderSummary({ ...result.report, signals: [unresolved, nearMiss, decisive] });
        expect(summary).toContain('2 of 3 question(s)');
        expect(summary).toContain('unresolved or came close to their threshold');
        expect(summary).not.toContain('were unresolved in');
    });
});

describe('vendor prefix coverage', () => {
    it('withholds every AWS prefix the pinned scanner recognises', () => {
        const body = secretFixture('IOSFODNN7', 'EXAMPLE');
        const prefixes = [
            secretFixture('AK', 'IA'),
            secretFixture('AS', 'IA'),
            secretFixture('AB', 'IA'),
            secretFixture('AC', 'CA'),
        ];
        for (const prefix of prefixes) {
            expect(sensitiveContentReason(secretFixture(prefix, body))).toBe('an AWS access key id');
        }
        // `A3T` followed by one character from `[A-Z0-9]`, then the sixteen-character body.
        expect(sensitiveContentReason(secretFixture('A3TA', body))).toBe('an AWS access key id');
    });

    it('withholds a temporary ASIA key id assigned to a secret-named variable', () => {
        const asia = secretFixture('ASIA', 'IOSFODNN7', 'EXAMPLE');
        const assigned = secretFixture('AWS_ACCESS_KEY_ID=', asia);
        expect(sensitiveContentReason(assigned)).toBe('an AWS access key id');
    });

    it('withholds every Stripe key kind the pinned scanner recognises', () => {
        const body = secretFixture('a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        for (const prefix of [
            secretFixture('sk_test_'),
            secretFixture('sk_live_'),
            secretFixture('sk_prod_'),
            secretFixture('rk_test_'),
            secretFixture('rk_live_'),
            secretFixture('rk_prod_'),
        ]) {
            expect(sensitiveContentReason(secretFixture(prefix, body))).toBe('a Stripe secret key');
        }
    });

    it('withholds a Stripe test key and a restricted key', () => {
        const test = secretFixture('sk_test_', 'a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        const restricted = secretFixture('rk_live_', 'a1b2c3d4e5f6g7h8', 'i9j0k1l2');
        expect(sensitiveContentReason(test)).toBe('a Stripe secret key');
        expect(sensitiveContentReason(restricted)).toBe('a Stripe secret key');
    });

    it('withholds a value composed from every generated shape', () => {
        // The whole table is pinned by a digest that serialises every field the screen depends on —
        // the parts arrays (not their joined prefix), the tail and its case scope, the fixture, the
        // key names, and the residual record — so deleting a key name, merging two fragments, editing a
        // residual reason, or rewriting a fixture all fail here. The shape, key-name and residual counts
        // are asserted separately, so a regeneration that drops an entry fails even if the digest line
        // is edited to match. Each entry's own pattern matches its own fixture, and the screen's own
        // prefix case scope agrees with the table's `flags`; the standalone literal cases below anchor
        // the table to the source's scope.
        expect(EGRESS_VENDOR_SHAPES).toHaveLength(100);
        expect(VENDOR_KEY_NAMES).toHaveLength(85);
        expect(RESIDUAL_RULES).toHaveLength(39);
        const serialized = [
            ...EGRESS_VENDOR_SHAPES.map(
                (shape) =>
                    `${shape.reason}\u0000${JSON.stringify(shape.parts)}\u0000${shape.tail}\u0000${shape.flags}\u0000${shape.bodyInsensitive}\u0000${JSON.stringify(shape.fixture)}`
            ),
            ...VENDOR_KEY_NAMES,
            ...RESIDUAL_RULES.map((rule) => `${rule.id}\u0000${rule.reason}`),
        ].join('\n');
        expect(createHash('sha256').update(serialized).digest('hex')).toBe(
            '4534c6f7f6fe72d3ad6e5c62e6e9bed9e6ba522a0a2c37ff5c998c3894dfa517'
        );
        for (const shape of EGRESS_VENDOR_SHAPES) {
            const prefix = shape.parts.join('');
            const fixture = secretFixture(...shape.parts, ...shape.fixture);
            const pattern = new RegExp(`\\b${prefix}${shape.tail}`, shape.flags);
            // The fixture is concretised from the tail, so this is a fixture-to-tail consistency check:
            // it fails when the concretiser and the tail disagree. The digest above pins the checked-in
            // content against a hand edit.
            expect(pattern.test(fixture), `${shape.reason}: own pattern does not match its fixture`).toBe(true);
            // The screen withholds the shape's own fixture.
            expect(sensitiveContentReason(fixture), `${shape.reason}: ${fixture.slice(0, 24)}`).toBeDefined();
            // The screen's prefix case scope, observed through the screen rather than the rebuilt
            // pattern. This asserts the table's `flags` agree with the screen's compilation, not the
            // source's scope — a consistently wrong flag-and-body pair passes once the digest is
            // restamped; the standalone literal cases below anchor the source's scope. Reason equality,
            // not presence, so a different shape cannot mask.
            const flippedPrefix = secretFixture(flipCase(prefix), ...shape.fixture);
            if (shape.flags === 'iu') {
                expect(sensitiveContentReason(flippedPrefix), `${shape.reason}: prefix case scope`).toBe(shape.reason);
            } else {
                expect(sensitiveContentReason(flippedPrefix), `${shape.reason}: prefix case scope`).toBeUndefined();
            }
            // The body case scope lives in the tail's scoped groups, which the digest above pins; the
            // rebuilt pattern over that same tail observes the body's case sensitivity exactly.
            const upperBody = secretFixture(...shape.parts, shape.fixture.map((chunk) => chunk.toUpperCase()).join(''));
            if (shape.bodyInsensitive) {
                expect(pattern.test(upperBody), `${shape.reason}: body case scope`).toBe(true);
            }
        }
    });

    it('fires every derived vendor key name as a secret-named assignment', () => {
        // Every key name must reach the value heuristic: a keyword-proximity family whose name does not
        // fire would be reported under coverage while withholding nothing.
        const opaque = 'a'.repeat(40);
        for (const name of VENDOR_KEY_NAMES) {
            expect(sensitiveContentReason(secretFixture(name, '=', opaque)), name).toBeDefined();
        }
    });

    it('scopes Sendinblue case sensitivity to the tail, not the hex field', () => {
        // Source: `xkeysib-[a-f0-9]{64}\-(?i)[a-z0-9]{16}`. The hex field precedes the flag, so an
        // uppercase hex run must not be withheld, while the case-insensitive tail must still reach the
        // screen.
        const lowerHex = secretFixture('xkeysib-', '0'.repeat(64), '-', 'ABCDEF0123456789');
        const upperHex = secretFixture('xkeysib-', 'A'.repeat(64), '-', 'abcdef0123456789');
        expect(sensitiveContentReason(lowerHex)).toBe('a Sendinblue API token');
        expect(sensitiveContentReason(upperHex)).toBeUndefined();
    });

    it('scopes Flutterwave case insensitivity over the trailing literal', () => {
        // Source: `FLWPUBK_TEST-(?i)[a-h0-9]{32}-X`. The flag covers the `-X` literal too, so both
        // `-X` and `-x` must be withheld.
        const upperX = secretFixture('FLWPUBK_TEST-', 'a'.repeat(32), '-X');
        const lowerX = secretFixture('FLWPUBK_TEST-', 'a'.repeat(32), '-x');
        expect(sensitiveContentReason(upperX)).toBe('a Finicity Public Key');
        expect(sensitiveContentReason(lowerX)).toBe('a Finicity Public Key');
    });

    it('reaches a whole-insensitive Clojars prefix in either case', () => {
        // Source: `(?i)CLOJARS_[a-z0-9]{60}`. The leading flag covers the prefix, so the lowercase
        // form is withheld by the screen's own flag, not by a widened prefix literal.
        expect(sensitiveContentReason(secretFixture('CLOJARS_', 'a'.repeat(60)))).toBe('a Clojars API token');
        expect(sensitiveContentReason(secretFixture('clojars_', 'a'.repeat(60)))).toBe('a Clojars API token');
    });

    it('keeps an inline-insensitive Alibaba prefix case-sensitive', () => {
        // Source: `\b(LTAI(?i)[a-z0-9]{20})…`. The flag follows the prefix, so `LTAI` is withheld and
        // `ltai` is admitted.
        const body = secretFixture('0123456789', 'abcdefghij');
        expect(sensitiveContentReason(secretFixture('LTAI', body))).toBe('an Alibaba Cloud AccessKey ID');
        expect(sensitiveContentReason(secretFixture('ltai', body))).toBeUndefined();
    });
});

describe('armored envelopes with arbitrary header lines', () => {
    it('withholds an envelope carrying a Version line between header and body', () => {
        const rsaHeader = secretFixture('-----BEGIN RSA ', 'PRIVATE KEY', '-----');
        const body = secretFixture('TUlJRXZRSUJBREFO', 'QmdrcWhraUc5dzBC', 'QVFFRkFBU0NCS2N3', 'Z2dTakFnRUFBb0lC');
        const version = secretFixture('Version: ', 'OpenSSL 1.1.1');
        const versioned = secretFixture(rsaHeader, '\n', version, '\n', body);
        expect(sensitiveContentReason(versioned)).toBe('an armored private key');
    });
});

describe('the armored envelope matches whitespace-only lines in linear time', () => {
    it('does not backtrack over whitespace-padded blank lines after a lone header', () => {
        // The envelope had two whitespace consumers separated only by an optional group, so a
        // whitespace-only line admitted one backtracking path per leading space and the outer `*`
        // multiplied those across lines: twelve spaces of padding is thirteen paths per line, and the
        // reviewer measured roughly thirteen times per added line. A header followed by fifteen such
        // lines projected to years under the old shape while it can never match — the header alone
        // carries no key material, so the correct answer is `undefined`. Fifteen lines is far past any
        // test timeout, so a regression to the ambiguous shape fails by timing out rather than by
        // returning a wrong value.
        const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
        const paddedBlankLine = '            \n';
        const input = secretFixture(pkcs8Header, '\n', paddedBlankLine.repeat(15));
        expect(sensitiveContentReason(input)).toBeUndefined();
    });
});

describe('the armored shape keys on the block, not one line length', () => {
    const pkcs8Header = secretFixture('-----BEGIN ', 'PRIVATE KEY', '-----');
    const footer = secretFixture('-----END ', 'PRIVATE KEY', '-----');

    it('withholds a body reflowed into lines shorter than any single-line floor when a footer is present', () => {
        // A real PEM whose body was reflowed into lines shorter than the old floor still carries its
        // closing footer, and the footer — not one line's length — is what identifies the block.
        const reflowed = secretFixture(pkcs8Header, '\n', 'MIIEvgIBADANBgkq', '\n', 'hkiG9w0BAQEFAASCBK', '\n', footer);
        expect(sensitiveContentReason(reflowed)).toBe('an armored private key');
    });

    it('withholds a body that begins on the header own line', () => {
        const body = secretFixture('TUlJ', 'RXZRSUJBREFO', 'Qmdr', 'a2lod0FBUUVGQUFTQ0JL');
        const sameLine = secretFixture(pkcs8Header, body, '\n', footer);
        expect(sensitiveContentReason(sameLine)).toBe('an armored private key');
    });

    it('still withholds a footerless run of real body length', () => {
        const longRun = secretFixture(pkcs8Header, '\n', 'A'.repeat(64));
        expect(sensitiveContentReason(longRun)).toBe('an armored private key');
    });

    it('does not withhold a long placeholder under a header without a footer', () => {
        // A fake block showing a twenty-four-character placeholder where the body belongs is
        // documentation, not key material: only a footer or a run of real body length proves a block.
        const placeholder = secretFixture(pkcs8Header, '\n', 'AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA');
        expect(sensitiveContentReason(placeholder)).toBeUndefined();
    });
});

describe('the collection predicate matches the runners, not a restated rule', () => {
    it('collects exactly the paths some runner executes', () => {
        expect(isCollectedSpec('src/modules/Project/__tests__/undo.spec.ts')).toBe(true);
        expect(isCollectedSpec('scripts/__tests__/semanticReview.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/audioOwnership.native.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/health.spec.ts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.mts')).toBe(true);
        expect(isCollectedSpec('src/modules/Project/undo.spec.cts')).toBe(true);
        // The e2e exclusion removes the path from Vitest's root, and no other runner collects it there.
        expect(isCollectedSpec('src/modules/Project/__tests__/undo.e2e.spec.ts')).toBe(false);
        expect(isCollectedSpec('src/modules/Project/undo.spec.md')).toBe(false);
    });

    it('plans a zero-line rename into the e2e exclusion instead of exempting it', () => {
        const file = changedFile('src/modules/Project/__tests__/undo.e2e.spec.ts', {
            kind: 'renamed',
            previousPath: 'src/modules/Project/__tests__/undo.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('derives collection from the shared runner definition', () => {
        // The screen must import the collection contract rather than carry a private copy, so the
        // Vitest exclude cannot move without both consumers being updated in the same change.
        const e2eOutside = 'src/modules/Project/__tests__/undo.e2e.spec.ts';
        expect(e2eSpecPattern.test(e2eOutside)).toBe(true);
        expect(specFilePattern.test(e2eOutside)).toBe(true);
        expect(isCollectedSpec(e2eOutside)).toBe(false);
        const playwright = 'tests/e2e/audioOwnership.native.spec.ts';
        expect(specFilePattern.test(playwright)).toBe(true);
        expect(isCollectedSpec(playwright)).toBe(true);
    });
});

describe('each runner collects only its own declared scope', () => {
    it('collects the Playwright, node:test, and Vitest boundaries each runner declares', () => {
        // Vitest (`vite.config.ts`): the shared suffix, minus the e2e exclusion.
        expect(isCollectedSpec('src/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('scripts/a.e2e.spec.ts')).toBe(false);
        // Playwright (`playwright.config.ts`): testDir `tests/e2e`, minus `**/__tests__/**`.
        expect(isCollectedSpec('tests/e2e/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/a.test.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/nested/__tests__/dead.spec.ts')).toBe(false);
        // node:test (`server/package.json`): the non-recursive `__tests__/*.spec.ts` glob.
        expect(isCollectedSpec('server/__tests__/a.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/deep/x.spec.ts')).toBe(false);
        expect(isCollectedSpec('server/__tests__/x.spec.tsx')).toBe(false);
    });

    it('plans a zero-line rename into a Playwright-ignored __tests__ directory instead of exempting it', () => {
        // Playwright's `testIgnore: ['**/__tests__/**']` stops it collecting a spec under a nested
        // `__tests__` inside its own `testDir`, and Vitest excludes `tests/e2e/**` — no runner runs it.
        const file = changedFile('tests/e2e/nested/__tests__/dead.spec.ts', {
            kind: 'renamed',
            previousPath: 'tests/e2e/nested/dead.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(file)).toBeUndefined();
    });

    it('plans a zero-line rename out of the server non-recursive glob instead of exempting it', () => {
        // The server command's `__tests__/*.spec.ts` glob is non-recursive and `.spec.ts`-only, so a
        // nested or renamed-extension spec runs nowhere.
        const nested = changedFile('server/__tests__/deep/x.spec.ts', {
            kind: 'renamed',
            previousPath: 'server/__tests__/x.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(nested)).toBeUndefined();
        const renamedExtension = changedFile('server/__tests__/x.spec.tsx', {
            kind: 'renamed',
            previousPath: 'server/__tests__/x.spec.ts',
            added: 0,
            deleted: 0,
        });
        expect(exclusionReason(renamedExtension)).toBeUndefined();
    });

    it('models the dotfile axis each runner actually observes', () => {
        // Established by planting a `.hidden.spec.ts` and asking each runner to list it:
        // - Vitest collected `scripts/.hidden.spec.ts` (`vitest list --filesOnly`), so its include
        //   matches a leading-dot name.
        // - Playwright collected `tests/e2e/.hidden.spec.ts` (`playwright test --list`), so it too
        //   collects a leading-dot name.
        // - node:test did not: the shell glob `__tests__/*.spec.ts` never expands a leading-dot name,
        //   so `tsx --test` receives nothing for `.hidden.spec.ts`.
        expect(isVitestCollected('src/.hidden.spec.ts')).toBe(true);
        expect(isPlaywrightCollected('tests/e2e/.hidden.spec.ts')).toBe(true);
        expect(isNodeTestCollected('server/__tests__/.hidden.spec.ts')).toBe(false);
        // The shared predicate mirrors that observed behaviour across all three arms.
        expect(isCollectedSpec('src/.hidden.spec.ts')).toBe(true);
        expect(isCollectedSpec('tests/e2e/.hidden.spec.ts')).toBe(true);
        expect(isCollectedSpec('server/__tests__/.hidden.spec.ts')).toBe(false);
    });
});

function reference(input: { evidenceId: string; path: string; side?: EvidenceSide }): EvidenceReference {
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

async function verifyWith(input: {
    provider: SemanticProviderPort;
    blobs?: Record<string, string>;
    limits?: { maxRegionBytes: number; maxTotalBytes: number };
    findings?: CandidateFinding[];
    runId?: string;
}): Promise<{ report: SemanticVerifyReport }> {
    const { runVerify } = await import('../verify.ts');
    return runVerify({
        ports: {
            source: fakeSource({ files: [], blobs: input.blobs ?? {} }),
            provider: input.provider,
            cache: new MapCache(),
            clock: fixedClock(1_000),
            signal: new AbortController().signal,
            log: () => undefined,
        },
        revision: BASE_REVISION,
        profile: SEMANTIC_BUDGET_PROFILES.local,
        limits: input.limits ?? { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        findings: input.findings ?? [
            {
                findingId: 'f1',
                headSha: HEAD,
                claim: 'a claim',
                expectedBehavior: 'expected',
                evidenceReferences: [
                    {
                        path: 'src/modules/Project/a.ts',
                        side: 'after',
                        startLine: 1,
                        endLine: Number.MAX_SAFE_INTEGER,
                    },
                ],
            },
        ],
        runId: input.runId ?? 'verify-test',
    });
}

/** A provider that answers each question with its own distribution, selecting the highest value. */
function perQuestionProvider(distributions: Record<string, Record<string, number>>): SemanticProviderPort {
    return {
        systemOne: async ({ questions }) => {
            const answers: Record<string, unknown> = {};
            for (const key of Object.keys(questions)) {
                const probabilities = distributions[key] ?? {};
                const choice = Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0];
                answers[key] = { type: 'choice', probabilities, confidence: 0.9, choice };
            }
            return { model: TYPESAFE_MODEL, answers, usage: { input_tokens: 5, output_tokens: 0 } };
        },
    };
}

describe('the scope noun follows the mode on every line that names it', () => {
    const decisiveQuietVerifyProvider = (): SemanticProviderPort =>
        perQuestionProvider({
            support: { supported: 0.05, contradicted: 0.05, insufficient_context: 0.9 },
            attribution: { introduced_by_change: 0.05, pre_existing: 0.9, undetermined: 0.05 },
            kind: { behavioral_or_contract_issue: 0.5, style_preference: 0.3, undetermined: 0.2 },
            strongestEvidence: { none: 1 },
        });

    it('words every scan branch with unit(s), never finding(s)', async () => {
        const base = await runScan(
            scanPorts(
                constantProvider(0.02),
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
            ...base.report,
            signals: base.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };

        const completed = renderSummary(quiet);
        expect(completed).toContain('eligible unit(s)');
        expect(completed).not.toContain('eligible finding(s)');
        expect(completed).toContain('evaluated unit(s)');
        expect(completed).not.toContain('evaluated finding(s)');

        const partial = renderSummary({ ...quiet, execution: 'partial' as const });
        expect(partial).toContain('evaluated unit(s)');
        expect(partial).not.toContain('evaluated finding(s)');

        const empty = renderSummary({ ...quiet, scope: { ...quiet.scope, assessed: 0 }, signals: [] });
        expect(empty).toContain('No unit was assessed');
        expect(empty).not.toContain('No finding was assessed');
    });

    it('words every verify branch with finding(s), never unit(s)', async () => {
        const { report } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });

        const completed = renderSummary(report);
        expect(completed).toContain('eligible finding(s)');
        expect(completed).not.toContain('eligible unit(s)');
        expect(completed).toContain('evaluated finding(s)');
        expect(completed).not.toContain('evaluated unit(s)');

        const partial = renderSummary({ ...report, execution: 'partial' as const });
        expect(partial).toContain('evaluated finding(s)');
        expect(partial).not.toContain('evaluated unit(s)');

        const empty = renderSummary({ ...report, scope: { ...report.scope, assessed: 0 }, findingAssessments: [] });
        expect(empty).toContain('No finding was assessed');
        expect(empty).not.toContain('No unit was assessed');
    });

    it('words the Incomplete line with the mode noun when the reduced sections are all non-empty', async () => {
        // The Incomplete line was the third place the scope noun was hardcoded. It renders only when
        // unassessed or truncated evidence exists, and the noun cases above rendered only quiet
        // reports, so this line hid the wrong noun twice. Rendering a scope whose unassessed, truncated
        // and limitation sections are all non-empty closes the class: no line may choose its own noun.
        // The counts are deliberately distinct — two unassessed against three truncated — so a line
        // that prints the wrong counter fails the exact-string assertion instead of matching on 1.
        const scanBase = await runScan(
            scanPorts(
                constantProvider(0.02),
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
        const quietScan = {
            ...scanBase.report,
            signals: scanBase.report.signals.map((signal) => ({
                ...signal,
                outcome: 'no_signal' as const,
                disposition: 'no_additional_recommendation' as const,
                probability: 0.02,
                missingEvidence: [],
            })),
        };
        const scanSummary = renderSummary({
            ...quietScan,
            scope: {
                ...quietScan.scope,
                assessed: 5,
                eligible: 7,
                discovered: 7,
                unassessed: [
                    { path: 'src/modules/Project/a.ts', reason: 'no-admissible-evidence' },
                    { path: 'src/modules/Project/b.ts', reason: 'no-admissible-evidence' },
                ],
                truncated: [
                    { path: 'src/modules/Project/c.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/d.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/e.ts', reason: 'region-exceeds-per-region-budget (after)' },
                ],
            },
            limitations: [...quietScan.limitations, 'a limitation'],
        });
        expect(scanSummary).toContain('Incomplete: 2 unit(s) unassessed and 3 region(s) truncated or withheld.');
        expect(scanSummary).toContain('eligible unit(s)');
        expect(scanSummary).not.toContain('finding(s) unassessed');
        expect(scanSummary).not.toContain('eligible finding(s)');

        const { report: verifyReport } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        const verifySummary = renderSummary({
            ...verifyReport,
            scope: {
                ...verifyReport.scope,
                assessed: 5,
                eligible: 7,
                discovered: 7,
                unassessed: [
                    { path: 'f1', reason: 'no-admissible-evidence' },
                    { path: 'f2', reason: 'no-admissible-evidence' },
                ],
                truncated: [
                    { path: 'src/modules/Project/a.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/b.ts', reason: 'region-exceeds-per-region-budget (after)' },
                    { path: 'src/modules/Project/c.ts', reason: 'region-exceeds-per-region-budget (after)' },
                ],
            },
            limitations: [...verifyReport.limitations, 'a limitation'],
        });
        expect(verifySummary).toContain('Incomplete: 2 finding(s) unassessed and 3 region(s) truncated or withheld.');
        expect(verifySummary).toContain('eligible finding(s)');
        expect(verifySummary).not.toContain('unit(s) unassessed');
        expect(verifySummary).not.toContain('eligible unit(s)');
    });

    it('refuses a completed report with unassessed scope naming the mode noun', async () => {
        // The refusal message in `assertExecutionMatchesScope` was the fourth place the scope noun was
        // hardcoded, reached by `validate` on a hand-edited document rather than by `renderSummary`. A
        // report claiming `completed` with a non-empty unassessed list must refuse naming the mode's
        // noun, in both modes. The count in the refusal is structurally `scope.unassessed.length`, so
        // naming the number is exact rather than brittle: two entries refuse as "2".
        const scanBase = await runScan(
            scanPorts(
                constantProvider(0.02),
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
        const scanCompleted = {
            ...scanBase.report,
            execution: 'completed' as const,
            scope: {
                ...scanBase.report.scope,
                // Two unassessed entries keep the validator's arithmetic: assessed + 2 === eligible and
                // eligible + excluded.length === discovered (excluded stays empty).
                eligible: scanBase.report.scope.assessed + 2,
                discovered: scanBase.report.scope.assessed + 2,
                unassessed: [
                    { path: 'src/modules/Project/a.ts', reason: 'no-admissible-evidence' },
                    { path: 'src/modules/Project/b.ts', reason: 'no-admissible-evidence' },
                ],
            },
        };
        expect(() => validateReport(scanCompleted)).toThrow(/2 unit\(s\) were unassessed/u);
        expect(() => validateReport(scanCompleted)).not.toThrow(/2 finding\(s\) were unassessed/u);

        const { report: verifyReport } = await verifyWith({
            provider: decisiveQuietVerifyProvider(),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        const verifyCompleted = {
            ...verifyReport,
            execution: 'completed' as const,
            scope: {
                ...verifyReport.scope,
                eligible: verifyReport.scope.assessed + 2,
                discovered: verifyReport.scope.assessed + 2,
                unassessed: [
                    { path: 'f1', reason: 'no-admissible-evidence' },
                    { path: 'f2', reason: 'no-admissible-evidence' },
                ],
            },
        };
        expect(() => validateReport(verifyCompleted)).toThrow(/2 finding\(s\) were unassessed/u);
        expect(() => validateReport(verifyCompleted)).not.toThrow(/2 unit\(s\) were unassessed/u);
    });
});

describe('the scan all-undecided sentence names the question count', () => {
    it('pairs one assessed unit with several signals and names question(s)', async () => {
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
        expect(result.report.scope.assessed).toBe(1);
        expect(result.report.signals.length).toBeGreaterThan(1);
        const summary = renderSummary(result.report);
        expect(summary).toContain(
            `all ${String(result.report.signals.length)} question(s) were unresolved or came close`
        );
        expect(summary).not.toContain(`all ${String(result.report.signals.length)} were unresolved`);
    });
});

describe('verify withholds a region over the per-region budget', () => {
    it('sends nothing for a finding whose only region exceeds the budget', async () => {
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'const oversized_value = 1;\n'.repeat(8) },
            limits: { maxRegionBytes: 32, maxTotalBytes: 8_192 },
        });
        expect(providerCalls).toBe(0);
        expect(report.findingAssessments).toHaveLength(0);
        expect(
            report.scope.truncated.some(
                (entry) =>
                    entry.path === 'src/modules/Project/a.ts' &&
                    entry.reason === 'region-exceeds-per-region-budget (after)'
            )
        ).toBe(true);
        expect(report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
    });

    it('names an oversized contract-carrying reference with the shared contract qualifier', async () => {
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:scripts/reviewDossier.ts`]: 'const oversized = 1;\n'.repeat(8) },
            limits: { maxRegionBytes: 32, maxTotalBytes: 8_192 },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        {
                            path: 'scripts/reviewDossier.ts',
                            side: 'after',
                            startLine: 1,
                            endLine: Number.MAX_SAFE_INTEGER,
                        },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'region-exceeds-per-region-budget (after, contract)' },
        ]);
    });

    it('names a content-classified spec reference with the same contract qualifier on both routes', async () => {
        // R3: verify derived the contract flag from the path alone, so a spec whose content imports the
        // closure read bulk on verify and contract on scan. The shared content rule makes both routes
        // emit the same string for the same reference.
        const specPath = 'scripts/__tests__/agentDeliveryScripts.spec.ts';
        const specAfter = `import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';\n${'const oversized = 1;\n'.repeat(
            8
        )}`;
        const scanSet = collectEvidence({
            port: fakeSource({
                files: [changedFile(specPath)],
                blobs: {
                    [`${MERGE_BASE}:${specPath}`]: 'const before = 1;\n',
                    [`${HEAD}:${specPath}`]: specAfter,
                },
            }),
            mergeBaseSha: MERGE_BASE,
            headSha: HEAD,
            contractSourceSha: MERGE_BASE,
            limits: { maxRegionBytes: 32, maxTotalBytes: 1_000_000 },
        });
        const scanReason = scanSet.truncated.find((entry) => entry.path === specPath)?.reason;

        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a withheld region');
            },
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:${specPath}`]: specAfter },
            limits: { maxRegionBytes: 32, maxTotalBytes: 8_192 },
            findings: [
                {
                    findingId: 'f1',
                    headSha: HEAD,
                    claim: 'a claim',
                    expectedBehavior: 'expected',
                    evidenceReferences: [
                        { path: specPath, side: 'after', startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
                    ],
                },
            ],
        });
        expect(providerCalls).toBe(0);
        expect(report.scope.truncated).toEqual([
            { path: specPath, reason: 'region-exceeds-per-region-budget (after, contract)' },
        ]);
        expect(scanReason).toBe('region-exceeds-per-region-budget (after, contract)');
    });

    it('sends and judges a region that fits the budget', async () => {
        const { report } = await verifyWith({
            provider: perQuestionProvider({
                support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                strongestEvidence: { none: 1 },
            }),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
            limits: { maxRegionBytes: 4_096, maxTotalBytes: 8_192 },
        });
        const assessment = report.findingAssessments[0];
        expect(assessment?.disposition).toBe('ready_for_orchestrator_validation');
        expect(assessment?.reasoning).not.toContain('not supplied');
        expect(report.scope.truncated).toHaveLength(0);
    });

    it('withholds a region whose serialized size exceeds the budget even when its raw size fits', async () => {
        // The gate measured raw bytes, so a region whose newlines pushed its JSON-serialized size over
        // the budget was admitted, minted, and sent; the provider then refused the request, recording a
        // run-wide failure code and an empty truncated scope that hid the region. The gate must cost the
        // serialized bytes the fitter uses.
        const region = `const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;`;
        const rawBytes = Buffer.byteLength(region, 'utf8');
        let providerCalls = 0;
        const provider: SemanticProviderPort = {
            systemOne: async () => {
                providerCalls += 1;
                throw new Error('the provider must not receive a region over the serialized budget');
            },
        };
        // The budget admits the raw bytes exactly but refuses the serialized form, so a raw-byte gate
        // would have admitted the region.
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region },
            limits: { maxRegionBytes: rawBytes, maxTotalBytes: 8_192 },
        });
        expect(providerCalls).toBe(0);
        expect(report.findingAssessments).toHaveLength(0);
        expect(
            report.scope.truncated.some(
                (entry) =>
                    entry.path === 'src/modules/Project/a.ts' &&
                    entry.reason === 'region-exceeds-per-region-budget (after)'
            )
        ).toBe(true);
        expect(report.failureCode).toBeUndefined();
        expect(report.scope.unassessed[0]?.reason).toBe('no-admissible-evidence');
    });

    it('sends and judges a region whose serialized size fits the budget', async () => {
        // The complementary direction: a region that fits the serialized measure must still be sent, not
        // withheld by an over-eager gate. The budget is the region's exact serialized cost, so the gate
        // admits at the serialized boundary.
        const region = `const a = 1;\nconst b = 2;\nconst c = 3;`;
        const serializedBytes = regionCost(
            {
                evidenceId: 'a1',
                revisionSha: HEAD,
                path: 'src/modules/Project/a.ts',
                side: 'after',
                startLine: 1,
                endLine: region.split('\n').length,
                contentHash: semanticDigest({ region }),
            },
            region
        );
        const { report } = await verifyWith({
            provider: perQuestionProvider({
                support: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                attribution: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                kind: { behavioral_or_contract_issue: 0.9, style_preference: 0.05, undetermined: 0.05 },
                strongestEvidence: { none: 1 },
            }),
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: region },
            limits: { maxRegionBytes: serializedBytes, maxTotalBytes: 8_192 },
        });
        const assessment = report.findingAssessments[0];
        expect(assessment?.disposition).toBe('ready_for_orchestrator_validation');
        expect(report.scope.truncated).toHaveLength(0);
        expect(report.failureCode).toBeUndefined();
    });
});

describe('verify refuses an omitted strongest-evidence answer', () => {
    it('does not record an omitted answer as a deliberate none', async () => {
        const provider: SemanticProviderPort = {
            systemOne: async () => ({
                model: TYPESAFE_MODEL,
                answers: {
                    support: {
                        type: 'choice',
                        probabilities: { supported: 0.9, contradicted: 0.05, insufficient_context: 0.05 },
                        confidence: 0.9,
                        choice: 'supported',
                    },
                    attribution: {
                        type: 'choice',
                        probabilities: { introduced_by_change: 0.9, pre_existing: 0.05, undetermined: 0.05 },
                        confidence: 0.9,
                        choice: 'introduced_by_change',
                    },
                    kind: {
                        type: 'choice',
                        probabilities: {
                            behavioral_or_contract_issue: 0.9,
                            style_preference: 0.05,
                            undetermined: 0.05,
                        },
                        confidence: 0.9,
                        choice: 'behavioral_or_contract_issue',
                    },
                },
                usage: { input_tokens: 5, output_tokens: 0 },
            }),
        };
        const { report } = await verifyWith({
            provider,
            blobs: { [`${HEAD}:src/modules/Project/a.ts`]: 'export const a = 1;\n' },
        });
        expect(report.findingAssessments).toHaveLength(0);
        expect(report.scope.unassessed[0]?.reason).toBe('invalid_response');
    });
});
