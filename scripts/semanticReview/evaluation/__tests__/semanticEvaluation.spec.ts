/**
 * The adjudicated evaluation corpus and the opt-in runner's extraction and rendering.
 *
 * Everything here is deterministic: the corpus is read from disk, the fixtures are planned with a stub
 * source port, and the provider is a stub that answers from a table. No Git revision is resolved and no
 * network call is made — the live run against the real provider is `pnpm review:semantic:evaluate`,
 * deliberately outside this suite.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    assertEvaluationIsOptIn,
    exitCodeFor,
    parseEvaluationArgs,
    runEvaluationCommand,
} from '../../../semanticReviewEvaluation.ts';
import { measureCheckout, readEvaluationOutcome } from '../../../semanticReviewMeasurement.ts';
import { changedLineFacts, type PathChangedLines, type UnitChangedLineFacts } from '../../changeFacts.ts';
import { SemanticFailure } from '../../contracts.ts';
import { createMemoryCache, TYPESAFE_MODEL, type SemanticProviderPort } from '../../provider.ts';
import { SEMANTIC_BUDGET_PROFILES, semanticRule } from '../../rules.ts';
import {
    parseEvaluationCorpus,
    restrictSourceToPath,
    SEMANTIC_EVALUATION_CORPUS_FORMAT,
    SEMANTIC_EVALUATION_CORPUS_PATH,
    SYNTHETIC_FIXTURE_REVISIONS,
    syntheticFixtureSource,
    type EvaluationCorpus,
    type EvaluationFixture,
    type SyntheticPositive,
} from '../corpus.ts';
import {
    fixtureEvaluationRevision,
    renderEvaluation,
    runEvaluation,
    type EvaluationFixturePlan,
} from '../runEvaluation.ts';

import type { MeasurementMachine } from '../../../semanticReviewMeasurement/contracts.ts';
import type { SemanticSourcePort } from '../../evidence.ts';

const PROFILE = SEMANTIC_BUDGET_PROFILES.ci;

const SHIPPED = JSON.parse(readFileSync(SEMANTIC_EVALUATION_CORPUS_PATH, 'utf8')) as unknown;

function shippedCorpus(): EvaluationCorpus {
    return parseEvaluationCorpus(SHIPPED, 'shipped corpus');
}

function fixtureOf(corpus: EvaluationCorpus, id: string): EvaluationFixture {
    const fixture = corpus.fixtures.find((candidate) => candidate.id === id);
    if (fixture === undefined) {
        throw new Error(`the corpus lost its ${id} fixture`);
    }
    return fixture;
}

function factsOf(fixture: EvaluationFixture): Extract<UnitChangedLineFacts, { basis: 'unified-diff' }> {
    if (fixture.changedLineFacts.basis !== 'unified-diff') {
        throw new Error(`fixture ${fixture.id} must carry a derived fact block`);
    }
    return fixture.changedLineFacts;
}

/** A corpus document edited in memory, so a refusal can be asserted without touching the shipped file. */
function tampered(edit: (document: Record<string, unknown>) => void): unknown {
    const document = structuredClone(SHIPPED) as Record<string, unknown>;
    edit(document);
    return document;
}

/** The fixtures of one kind, in document order. */
function entries(document: Record<string, unknown>): Record<string, unknown>[] {
    return document.fixtures as Record<string, unknown>[];
}

function entryById(document: Record<string, unknown>, id: string): Record<string, unknown> {
    const entry = entries(document).find((candidate) => candidate.id === id);
    if (entry === undefined) {
        throw new Error(`no fixture ${id}`);
    }
    return entry;
}

/**
 * A source port over a fixture the corpus records lines for but no text: the adjudicated negatives, whose
 * regions the live runner reads from Git. The stand-in places each recorded line at the number the corpus
 * records it at, so the plan and the request carry the corpus's facts without any revision being read.
 *
 * `secondPath` adds one more changed file under that path, serving the same text: the shape a revision
 * pair that touched two paths has, which is what a case driving a scope the run could not deliver needs.
 */
function standInSource(fixture: EvaluationFixture, secondPath?: string): SemanticSourcePort {
    const lineCount =
        Math.max(
            1,
            ...fixture.changedLines.added.map((line) => line.line),
            ...fixture.changedLines.removed.map((line) => line.line)
        ) + 4;
    const textFor = (lines: readonly { readonly line: number; readonly text: string }[]): string => {
        const body = Array.from(
            { length: lineCount },
            (_unused, index) => `    // unchanged line ${String(index + 1)}`
        );
        for (const line of lines) {
            body[line.line - 1] = line.text;
        }
        return `${body.join('\n')}\n`;
    };
    const rangeFor = (lines: readonly { readonly line: number }[]): { startLine: number; endLine: number } => {
        const numbers = lines.map((line) => line.line);
        return { startLine: Math.min(...numbers, 1), endLine: Math.max(...numbers, lineCount) };
    };
    const changedFileFor = (path: string) => ({
        path,
        kind: 'modified' as const,
        binary: false,
        generated: false,
        added: fixture.changedLines.added.length,
        deleted: fixture.changedLines.removed.length,
    });
    const hunksFor = (path: string) => ({
        path,
        before: [rangeFor(fixture.changedLines.removed)],
        after: [rangeFor(fixture.changedLines.added)],
    });
    const paths = secondPath === undefined ? [fixture.path] : [fixture.path, secondPath];
    const before = textFor(fixture.changedLines.removed);
    const after = textFor(fixture.changedLines.added);
    return {
        changedFiles: () => paths.map(changedFileFor),
        readFile: (sha, path) => {
            if (!paths.includes(path)) {
                return undefined;
            }
            if (sha === fixture.revisions.mergeBaseSha) {
                return before;
            }
            return sha === fixture.revisions.headSha ? after : undefined;
        },
        changedHunks: () => new Map(paths.map((path) => [path, hunksFor(path)])),
        changedLines: () => new Map(paths.map((path) => [path, fixture.changedLines])),
    };
}

/**
 * The stand-in source of one fixture with its recorded changed lines replaced: the state an adjudicated
 * negative reaches when the lines recorded beside its revisions have drifted from them, which no check on
 * the corpus's own text can see because a negative records no text.
 */
function driftedSource(fixture: EvaluationFixture, changedLines: PathChangedLines): SemanticSourcePort {
    return { ...standInSource(fixture), changedLines: () => new Map([[fixture.path, changedLines]]) };
}

/** The unit path a request's own state names, read without trusting the shape. */
function statePath(state: unknown): string {
    if (typeof state !== 'object' || state === null) {
        return '';
    }
    const unit = (state as { unit?: unknown }).unit;
    if (typeof unit !== 'object' || unit === null) {
        return '';
    }
    const path = (unit as { path?: unknown }).path;
    return typeof path === 'string' ? path : '';
}

/**
 * A stub provider port: one probability per (path, rule) question, read from the request's own state so a
 * case can answer the fixture under test differently from the same rule asked about another fixture.
 */
function stubProvider(answerFor: (input: { readonly ruleId: string; readonly path: string }) => number): {
    port: SemanticProviderPort;
    asked: string[];
} {
    const asked: string[] = [];
    return {
        asked,
        port: {
            systemOne: async (request) => {
                const path = statePath(request.state);
                const answers: Record<string, unknown> = {};
                for (const ruleId of Object.keys(request.questions)) {
                    asked.push(ruleId);
                    answers[ruleId] = { type: 'noul', noul: answerFor({ ruleId, path }) };
                }
                return { model: TYPESAFE_MODEL, answers };
            },
        },
    };
}

/** The path of each synthetic positive, so a stub can answer the rule the fixture carries and no other. */
function positiveRules(corpus: EvaluationCorpus): ReadonlyMap<string, string> {
    return new Map(
        corpus.fixtures
            .filter((fixture) => fixture.fixture === 'synthetic-positive')
            .map((fixture) => [fixture.path, fixture.ruleId])
    );
}

function planForAll(): (fixture: EvaluationFixture) => EvaluationFixturePlan {
    return (fixture) => {
        if (fixture.fixture === 'synthetic-positive') {
            return {
                source: syntheticFixtureSource(fixture),
                sourceKind: 'corpus-fixture',
                revision: fixtureEvaluationRevision(fixture),
            };
        }
        return {
            source: standInSource(fixture),
            sourceKind: 'git-revisions',
            revision: fixtureEvaluationRevision(fixture),
        };
    };
}

/**
 * The same plan with one fixture's source replaced, which is how a case drives the state a live run reaches
 * for one fixture without changing what the others are assessed over.
 */
function planWithOneSource(
    fixtureId: string,
    sourceFor: (fixture: EvaluationFixture) => SemanticSourcePort
): (fixture: EvaluationFixture) => EvaluationFixturePlan {
    const standard = planForAll();
    return (fixture) => {
        if (fixture.id !== fixtureId) {
            return standard(fixture);
        }
        return {
            source: sourceFor(fixture),
            sourceKind: 'git-revisions',
            revision: fixtureEvaluationRevision(fixture),
        };
    };
}

/** The machine identity the measurement record carries; this case reads the fixtures it recorded, not it. */
const MEASUREMENT_MACHINE: MeasurementMachine = {
    checkoutGitSha: 'f'.repeat(40),
    workingTree: 'clean',
    host: { platform: 'darwin', release: '25.5.0', arch: 'arm64', cores: 12 },
    loadAverage1m: 0.5,
};

/** The temp roots a case writes an outcome file into, removed so a failure cannot leave one behind. */
const outcomeRoots: string[] = [];

afterEach(() => {
    for (const root of outcomeRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

async function evaluateWith(
    corpus: EvaluationCorpus,
    provider: SemanticProviderPort,
    planFor: (fixture: EvaluationFixture) => EvaluationFixturePlan = planForAll()
) {
    return await runEvaluation({
        corpus,
        ports: {
            provider,
            cache: createMemoryCache(),
            clock: { now: () => 1_700_000_000_000 },
            signal: new AbortController().signal,
            log: () => undefined,
        },
        profile: PROFILE,
        planFor,
        runId: 'evaluation-spec',
    });
}

describe('the shipped corpus', () => {
    it('should carry the versioned format and the four paired fixtures', () => {
        const corpus = shippedCorpus();
        expect(corpus.format).toBe(SEMANTIC_EVALUATION_CORPUS_FORMAT);
        expect(corpus.labelBasis).toBe('human-adjudication');
        expect(corpus.fixtures.map((fixture) => fixture.id)).toEqual([
            'descriptor-hash-retarget',
            'grid-label-retarget',
            'assertion-removed-without-replacement',
            'early-exit-without-asserting',
        ]);
        expect(fixtureOf(corpus, 'descriptor-hash-retarget').ruleId).toBe(
            'admission_branch_completes_without_asserting'
        );
        expect(fixtureOf(corpus, 'grid-label-retarget').ruleId).toBe('assertion_deleted');
    });

    it('should label both audited revisions as negatives with no concern and real revisions', () => {
        const corpus = shippedCorpus();
        for (const id of ['descriptor-hash-retarget', 'grid-label-retarget']) {
            const fixture = fixtureOf(corpus, id);
            expect(fixture.fixture).toBe('adjudicated-negative');
            expect(fixture.expected).toEqual({ applies: true, concern: 'none' });
            expect(fixture.revisions).toEqual({
                mergeBaseSha: '713084e2edaa2717dcce5d3b01a2091d7d96f69a',
                headSha: '30373c8859215e2ab97f1ccdacc0545940972faa',
            });
            expect(semanticRule(fixture.ruleId).appliesTo(fixture.path)).toBe(true);
            expect(fixture.adjudication.length).toBeGreaterThan(0);
        }
    });

    it('should label both authored fixtures as synthetic positives carrying their rule as the concern', () => {
        const corpus = shippedCorpus();
        for (const fixture of corpus.fixtures) {
            if (fixture.fixture !== 'synthetic-positive') {
                continue;
            }
            expect(fixture.expected).toEqual({ applies: true, concern: fixture.ruleId });
            expect(fixture.revisions).toEqual(SYNTHETIC_FIXTURE_REVISIONS);
            expect(semanticRule(fixture.ruleId).appliesTo(fixture.path)).toBe(true);
        }
    });

    it('should pair every negative with a positive of the same rule', () => {
        const corpus = shippedCorpus();
        for (const fixture of corpus.fixtures) {
            const partner = fixtureOf(corpus, fixture.pairedWith);
            expect(partner.ruleId).toBe(fixture.ruleId);
            expect(partner.fixture).not.toBe(fixture.fixture);
            expect(partner.pairedWith).toBe(fixture.id);
        }
    });
});

describe("the four fixtures' deterministic change facts", () => {
    it('should show the descriptor-hash negative as no added branch and no removed assertion', () => {
        const fixture = fixtureOf(shippedCorpus(), 'descriptor-hash-retarget');
        expect(factsOf(fixture)).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 0, lines: [], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 0, lines: [], truncated: false },
            },
        });
        // The only line the diff removed is the descriptor pin, and no line it added is an assertion.
        expect(fixture.changedLines.removed.map((line) => line.text)).toEqual(["    yeast: 'descriptor-v1:e58d800b',"]);
        expect(fixture.changedLines.added.some((line) => line.text.includes('expect('))).toBe(false);
    });

    it('should show the grid-label negative as assertions changed but not deleted', () => {
        const fixture = fixtureOf(shippedCorpus(), 'grid-label-retarget');
        const facts = factsOf(fixture);
        expect(facts.before.removedAssertions.lines).toEqual([166, 167, 174, 176]);
        expect(facts.before.removedAssertions.count).toBe(4);
        expect(facts.after.addedAssertions.lines).toEqual([169, 170, 175, 176]);
        expect(facts.after.addedAssertions.count).toBe(4);
        expect(facts.after.addedControlFlow).toEqual({ count: 0, lines: [], truncated: false });
        // Every removed assertion line is a label retarget with a note-value counterpart on the same
        // check, which is what the adjudication says: nothing is removed without a replacement.
        for (const removed of fixture.changedLines.removed.filter((line) => line.text.includes('expect('))) {
            expect(fixture.changedLines.added.some((line) => line.text.includes('expect('))).toBe(true);
            expect(removed.text).toMatch(/'(?:1|1\/2|1\/4)'/u);
        }
    });

    it('should show the assertion-deletion positive as the opposite: an assertion removed with no replacement', () => {
        const fixture = fixtureOf(shippedCorpus(), 'assertion-removed-without-replacement');
        expect(factsOf(fixture)).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 1, lines: [15], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 0, lines: [], truncated: false },
            },
        });
        if (fixture.fixture !== 'synthetic-positive') {
            throw new Error('this fixture must be the synthetic positive');
        }
        expect(fixture.changedLines.removed[0]?.text).toBe('        expect(track.gain).toBe(0.5);');
        expect(fixture.source.after).not.toContain('expect(track.gain).toBe(0.5);');
    });

    it('should show the early-exit positive as the opposite: an added branch with no assertion added', () => {
        const fixture = fixtureOf(shippedCorpus(), 'early-exit-without-asserting');
        expect(factsOf(fixture)).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 0, lines: [], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 2, lines: [12, 13], truncated: false },
            },
        });
        if (fixture.fixture !== 'synthetic-positive') {
            throw new Error('this fixture must be the synthetic positive');
        }
        expect(fixture.changedLines.added.map((line) => line.text)).toEqual([
            '        if (!toolbar.mounted) {',
            '            return;',
            '        }',
        ]);
        expect(fixture.source.after).toContain("        expect(toolbar.snapValue).toBe('1/16');");
    });

    it('should record only blocks the shipped classifier derives from the recorded lines', () => {
        for (const fixture of shippedCorpus().fixtures) {
            expect(changedLineFacts(fixture.changedLines)).toEqual(fixture.changedLineFacts);
        }
    });

    it('should keep every block well under a kibibyte', () => {
        for (const fixture of shippedCorpus().fixtures) {
            expect(Buffer.byteLength(JSON.stringify(fixture.changedLineFacts), 'utf8')).toBeLessThan(1024);
        }
    });
});

describe('the corpus is validated rather than trusted', () => {
    it('should refuse a declared line that its own text does not hold', () => {
        const document = tampered((corpus) => {
            const fixture = entryById(corpus, 'early-exit-without-asserting');
            const source = fixture.source as Record<string, unknown>;
            source.after = String(source.after).replace('if (!toolbar.mounted) {', 'if (!toolbar.ready) {');
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(/does not hold|holds/u);
    });

    it('should refuse a text change its declared changed lines do not cover', () => {
        // The derivation is what keeps a positive's fact block non-tautological: without it this fixture
        // adds an assertion-free branch outside its declared hunks and parses clean, so the block omits a
        // change its own text makes.
        const document = tampered((corpus) => {
            const fixture = entryById(corpus, 'early-exit-without-asserting');
            const source = fixture.source as Record<string, unknown>;
            // Appended rather than inserted, so the fixture's declared lines still sit at their numbers
            // and the text and hunk checks stay quiet: only the derived diff can see this change.
            source.after = `${String(source.after)}        if (!toolbar.ready) {\n            return;\n        }\n`;
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(/do not differ by/u);
    });

    it('should refuse a negative that carries a concern', () => {
        const document = tampered((corpus) => {
            const expected = entryById(corpus, 'grid-label-retarget').expected as Record<string, unknown>;
            expected.concern = 'assertion_deleted';
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(/may not carry a concern/u);
    });

    it('should refuse a fixture paired with a fixture of another rule or another kind', () => {
        const document = tampered((corpus) => {
            entryById(corpus, 'grid-label-retarget').pairedWith = 'early-exit-without-asserting';
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(
            /another rule|opposite kind|not paired/u
        );
    });

    it('should refuse an expectation the shipped rule set does not admit', () => {
        const document = tampered((corpus) => {
            entryById(corpus, 'grid-label-retarget').path = 'src/modules/TimelineEditor/ClipView.ts';
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(/does not apply/u);
    });

    it('should refuse a fact block that disagrees with the lines it claims to summarise', () => {
        const document = tampered((corpus) => {
            const fixture = entryById(corpus, 'early-exit-without-asserting');
            const facts = fixture.changedLineFacts as { after: { addedControlFlow: { count: number } } };
            facts.after.addedControlFlow.count = 3;
        });
        expect(() => parseEvaluationCorpus(document, 'tampered corpus')).toThrow(/classifier derives/u);
    });
});

describe('the rules that read the block name it and disclaim proof', () => {
    for (const ruleId of ['assertion_deleted', 'admission_branch_completes_without_asserting'] as const) {
        it(`should tell ${ruleId} where the facts are and that they are not proof`, () => {
            const rule = semanticRule(ruleId);
            expect(rule.instructions).toContain('state.unit.changedLines');
            expect(rule.instructions).toMatch(/never proof about behaviour/u);
            expect(rule.instructions).toContain('unavailable');
        });
    }

    it('should keep every counterexample the two rules already carried, and name the unavailable basis', () => {
        const deletion = semanticRule('assertion_deleted');
        const admission = semanticRule('admission_branch_completes_without_asserting');
        expect(deletion.counterexamples.some((entry) => entry.includes('unavailable'))).toBe(true);
        expect(deletion.counterexamples.some((entry) => entry.includes('stronger assertion'))).toBe(true);
        expect(admission.counterexamples.some((entry) => entry.includes('shared assertion helper'))).toBe(true);
        expect(admission.counterexamples.some((entry) => entry.includes('rethrows'))).toBe(true);
    });
});

describe('the synthetic fixture source', () => {
    it('should serve the fixture text by revision, its hunks, and its changed lines', () => {
        const corpus = shippedCorpus();
        const fixture = fixtureOf(corpus, 'assertion-removed-without-replacement');
        if (fixture.fixture !== 'synthetic-positive') {
            throw new Error('this fixture must be the synthetic positive');
        }
        const source: SemanticSourcePort = syntheticFixtureSource(fixture);
        const files = source.changedFiles(
            SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha,
            SYNTHETIC_FIXTURE_REVISIONS.headSha
        );
        expect(files).toHaveLength(1);
        expect(files[0]?.path).toBe(fixture.path);
        expect(source.readFile(SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha, fixture.path)).toBe(fixture.source.before);
        expect(source.readFile(SYNTHETIC_FIXTURE_REVISIONS.headSha, fixture.path)).toBe(fixture.source.after);
        expect(source.readFile(SYNTHETIC_FIXTURE_REVISIONS.headSha, 'src/modules/Other/a.ts')).toBeUndefined();
        expect(
            source
                .changedLines(SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha, SYNTHETIC_FIXTURE_REVISIONS.headSha)
                .get(fixture.path)
        ).toEqual(fixture.changedLines);
        expect(
            source
                .changedHunks(SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha, SYNTHETIC_FIXTURE_REVISIONS.headSha)
                .get(fixture.path)
        ).toEqual({ path: fixture.path, before: fixture.hunks.before, after: fixture.hunks.after });
    });

    it('should restrict a real source to the fixture path it grades', () => {
        const corpus = shippedCorpus();
        const fixture = fixtureOf(corpus, 'assertion-removed-without-replacement');
        const source = syntheticFixtureSource(fixture as SyntheticPositive);
        const restricted = restrictSourceToPath(source, 'src/modules/Elsewhere/__tests__/other.spec.ts');
        expect(restricted.changedFiles('a'.repeat(40), 'b'.repeat(40))).toEqual([]);
        expect(restricted.changedLines('a'.repeat(40), 'b'.repeat(40)).size).toBe(0);
        const samePath = restrictSourceToPath(source, fixture.path);
        expect(samePath.changedLines('a'.repeat(40), 'b'.repeat(40)).get(fixture.path)).toEqual(fixture.changedLines);
    });
});

describe('the opt-in runner', () => {
    it('should ask every fixture the rule under test and carry the recorded block', async () => {
        const corpus = shippedCorpus();
        const stub = stubProvider(() => 0.02);
        const result = await evaluateWith(corpus, stub.port);
        expect(result.outcomes).toHaveLength(4);
        for (const outcome of result.outcomes) {
            const fixture = fixtureOf(corpus, outcome.fixtureId);
            expect(outcome.rulesAsked).toContain(fixture.ruleId);
            expect(outcome.rulesNotAsked.map((entry) => entry.ruleId)).toContain('production_path_no_longer_reached');
            expect(
                outcome.rulesNotAsked.find((entry) => entry.ruleId === 'production_path_no_longer_reached')
                    ?.missingEvidence
            ).toEqual(['after implementation source']);
            expect(outcome.evidenceSupplied).toHaveLength(2);
            expect(outcome.thresholds[fixture.ruleId]).toBe(semanticRule(fixture.ruleId).thresholds.fire);
            expect(outcome.factsCarried).toEqual(fixture.changedLineFacts);
            expect(outcome.factsMatchCorpus).toBe(true);
            expect(outcome.execution).toBe('completed');
            expect(outcome.providerRequests).toBe(1);
        }
    });

    it('should report a negative whose source no longer reports the lines the corpus records', async () => {
        // A negative's recorded lines can drift from the revisions it names, and the block comparison
        // cannot see it: dropping the two added comment lines leaves the all-zero block the corpus records
        // on both sides, so a notice reading only the block calls the fixture a match. The lines
        // comparison is the check that ties a negative — the one kind of fixture with no text of its own —
        // to the revisions it grades.
        const corpus = shippedCorpus();
        const drifted: PathChangedLines = {
            added: [{ line: 80, text: "    yeast: 'descriptor-v1:f319bc9b'," }],
            removed: [{ line: 78, text: "    yeast: 'descriptor-v1:e58d800b'," }],
        };
        const result = await evaluateWith(
            corpus,
            stubProvider(() => 0.02).port,
            planWithOneSource('descriptor-hash-retarget', (fixture) => driftedSource(fixture, drifted))
        );
        const negative = result.outcomes.find((outcome) => outcome.fixtureId === 'descriptor-hash-retarget');
        expect(negative?.linesVerdict).toBe('differ');
        // The block the notice used to read alone still agrees, so this case cannot be passing on a block
        // mismatch instead of on the drift it exists to report.
        expect(negative?.factsMatchCorpus).toBe(true);
        expect(renderEvaluation(result)).toContain('matches corpus: true; lines: differ');
    });

    it('should report a carried block that is not the block the corpus records', async () => {
        // The false half of the drift notice: a request whose own lines derive a non-empty block while the
        // corpus records the all-zero one. A notice that answered a match whatever it was handed would
        // report the corpus as agreeing with a classifier that no longer derives its block.
        const corpus = shippedCorpus();
        const drifted: PathChangedLines = {
            added: [{ line: 80, text: "    expect(descriptorVersion).toBe('descriptor-v1:f319bc9b');" }],
            removed: [{ line: 78, text: "    yeast: 'descriptor-v1:e58d800b'," }],
        };
        const result = await evaluateWith(
            corpus,
            stubProvider(() => 0.02).port,
            planWithOneSource('descriptor-hash-retarget', (fixture) => driftedSource(fixture, drifted))
        );
        const negative = result.outcomes.find((outcome) => outcome.fixtureId === 'descriptor-hash-retarget');
        // The block the request carried is the classifier's own derivation from the source's lines, which
        // is what makes this case about the notice rather than about a hand-built block.
        expect(negative?.factsCarried).toEqual(changedLineFacts(drifted));
        expect(negative?.factsMatchCorpus).toBe(false);
        expect(renderEvaluation(result)).toContain('matches corpus: false');
    });

    it('should report a fixture no request asked as carrying nothing rather than as disagreeing', async () => {
        // The notice's third state: a source that offers no changed file leaves the run nothing to ask, so
        // no request carried a block and neither verdict is a disagreement with the corpus. A `differ` here
        // would report a drift for a fixture whose block was never derived.
        const corpus = shippedCorpus();
        const result = await evaluateWith(
            corpus,
            stubProvider(() => 0.02).port,
            planWithOneSource('descriptor-hash-retarget', (fixture) => ({
                ...standInSource(fixture),
                changedFiles: () => [],
            }))
        );
        const negative = result.outcomes.find((outcome) => outcome.fixtureId === 'descriptor-hash-retarget');
        expect(negative?.factsCarried).toBeUndefined();
        expect(negative?.factsMatchCorpus).toBeUndefined();
        expect(renderEvaluation(result)).toContain('no request carried a fact block (lines: match)');
    });

    it('should report lines that could not be read as unread rather than as a disagreement', async () => {
        // The unread state, from both reads that really fail: `gitSource.changedLines` throws on any git
        // failure, and a source whose map carries no entry for the fixture reports nothing either. The
        // collector tolerates both, so the fixture arrives with an `unavailable` block. A `differ` for
        // either clause would report a drift nobody observed — the same infrastructure-outcome-as-semantic
        // confusion the exit codes keep apart.
        const corpus = shippedCorpus();
        const unreadable: readonly (() => ReadonlyMap<string, PathChangedLines>)[] = [
            () => {
                throw new Error('git could not read the diff');
            },
            () => new Map<string, PathChangedLines>(),
        ];
        for (const changedLines of unreadable) {
            const result = await evaluateWith(
                corpus,
                stubProvider(() => 0.02).port,
                planWithOneSource('descriptor-hash-retarget', (fixture) => ({
                    ...standInSource(fixture),
                    changedLines,
                }))
            );
            const negative = result.outcomes.find((outcome) => outcome.fixtureId === 'descriptor-hash-retarget');
            expect(negative?.factsCarried).toEqual({ basis: 'unavailable' });
            expect(negative?.factsMatchCorpus).toBeUndefined();
            expect(negative?.linesVerdict).toBe('unread');
            expect(renderEvaluation(result)).toContain('{"basis":"unavailable"} (block: unread; lines: unread)');
            // The fixtures whose lines the same run could read keep their verdict, so `unread` is a property
            // of the read that failed and not a blanket answer: the other adjudicated negative still matches.
            expect(
                result.outcomes
                    .filter((outcome) => outcome.fixtureId !== 'descriptor-hash-retarget')
                    .every((outcome) => outcome.linesVerdict === 'match')
            ).toBe(true);
        }
    });

    it('should hold a negative when its rule stays quiet and a positive when its rule fires', async () => {
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const stub = stubProvider(({ ruleId, path }) => (positives.get(path) === ruleId ? 0.95 : 0.02));
        const result = await evaluateWith(corpus, stub.port);
        expect(result.expectationsHeld).toBe(4);
        for (const outcome of result.outcomes) {
            const fixture = fixtureOf(corpus, outcome.fixtureId);
            const labelled = outcome.outcomes.find((entry) => entry.ruleId === fixture.ruleId);
            expect(labelled?.outcome).toBe(fixture.fixture === 'synthetic-positive' ? 'signal' : 'no_signal');
        }
        // The stub answered every rule the request asked, and only those.
        expect(stub.asked).toContain('assertion_deleted');
        expect(stub.asked).toContain('admission_branch_completes_without_asserting');
    });

    it('should report a negative as not held when its rule fires, and exit nonzero', async () => {
        // The corpus's own recorded disagreement: the label-retarget negative fired `assertion_deleted` in
        // the one live run. A negative branch that answered "held" whatever the model said would report
        // every label held, so this case drives that fixture above its threshold and reads the count back.
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const firedNegativePath = fixtureOf(corpus, 'grid-label-retarget').path;
        const stub = stubProvider(({ ruleId, path }) => {
            if (positives.get(path) === ruleId) {
                return 0.95;
            }
            return path === firedNegativePath && ruleId === 'assertion_deleted' ? 0.72 : 0.02;
        });
        const result = await evaluateWith(corpus, stub.port);
        const negative = result.outcomes.find((outcome) => outcome.fixtureId === 'grid-label-retarget');
        expect(negative?.outcomes.find((entry) => entry.ruleId === 'assertion_deleted')?.outcome).toBe('signal');
        // The held count and the exit are what a softened negative branch would corrupt: every label would
        // read as held and the run would exit zero over the very disagreement the corpus records.
        expect(result.expectationsHeld).toBe(3);
        expect(negative?.expectedConcernHeld).toBe(false);
        expect(exitCodeFor(result)).not.toBe(0);
    });

    it('should refuse to call a positive held when the rule it labels never fires', async () => {
        const corpus = shippedCorpus();
        const result = await evaluateWith(corpus, stubProvider(() => 0.02).port);
        expect(result.expectationsHeld).toBe(2);
        const held = result.outcomes
            .filter((outcome) => outcome.expectedConcernHeld)
            .map((outcome) => outcome.fixtureId);
        expect(held).toEqual(['descriptor-hash-retarget', 'grid-label-retarget']);
    });

    it('should render the model, the questions, the evidence, the thresholds, the facts and the raw outcome', async () => {
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const result = await evaluateWith(
            corpus,
            stubProvider(({ ruleId, path }) => (positives.get(path) === ruleId ? 0.95 : 0.02)).port
        );
        const rendered = renderEvaluation(result);
        expect(rendered).toContain('4 fixture(s), 4 provider request(s)');
        expect(rendered).toContain('4/4 labelled expectations held');
        expect(rendered).toContain('advisory only');
        expect(rendered).toContain('grid-label-retarget (adjudicated-negative, expected no concern)');
        expect(rendered).toContain(
            'assertion-removed-without-replacement (synthetic-positive, expected concern assertion_deleted)'
        );
        expect(rendered).toContain('model     requested jev-1.13.0');
        expect(rendered).toContain('asked     assertion_deleted');
        expect(rendered).toContain('evidence  ');
        expect(rendered).toContain('thresholds assertion_deleted >= 0.70');
        expect(rendered).toContain('"basis":"unified-diff"');
        expect(rendered).toContain('matches corpus: true');
        expect(rendered).toContain('outcome   assertion_deleted: probability 0.950, signal, recommend_investigation');
    });

    it('should render a mismatch when a labelled expectation did not hold', async () => {
        const result = await evaluateWith(shippedCorpus(), stubProvider(() => 0.02).port);
        const rendered = renderEvaluation(result);
        expect(rendered).toContain('2/4 labelled expectations held');
        expect(rendered).toContain('the labelled expectation did NOT hold (an unasked question counts as not held)');
        expect(rendered).toContain('probability 0.020, no_signal, no_additional_recommendation');
    });
});

describe('the outcome file the measurement command reads', () => {
    it('should write the runner result the measurement reader accepts, end to end', async () => {
        // The two commands are one contract: the runner writes the file, `pnpm review:semantic:measure
        // --evaluation` reads it. A case that only fed the reader a hand-built object let the runner wrap
        // its result in an envelope the reader refused, so this one takes the bytes the runner writes and
        // hands them to the reader's own entry point.
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-evaluation-outcomes-'));
        outcomeRoots.push(root);
        const outcomePath = join(root, 'outcomes.json');
        // The command itself, with a stub provider and the corpus-backed source: the `--out` branch that
        // writes the file is inside it, so a case that called a write helper of its own would stay green
        // while the command wrapped its result again. The stub answers each positive's own rule so the
        // command completes as a held run and its exit code is the success path's.
        const exitCode = await runEvaluationCommand({
            argv: ['--out', outcomePath],
            sourceFor: planForAll(),
            portsFor: () => ({
                provider: stubProvider(({ ruleId, path }) => (positives.get(path) === ruleId ? 0.95 : 0.02)).port,
                cache: createMemoryCache(),
                clock: { now: () => 1_700_000_000_000 },
                signal: new AbortController().signal,
                log: () => undefined,
            }),
            log: () => undefined,
        });
        expect(exitCode).toBe(0);

        const onDisk = JSON.parse(readFileSync(outcomePath, 'utf8')) as Record<string, unknown>;
        expect(Object.keys(onDisk)).toContain('outcomes');
        expect(readEvaluationOutcome(outcomePath)).toHaveLength(corpus.fixtures.length);

        const record = measureCheckout({
            root,
            evaluationOutcomePath: outcomePath,
            strict: false,
            detail: 'runs',
            measuredAt: '2026-09-29T12:00:00.000Z',
            machine: MEASUREMENT_MACHINE,
        });
        expect(record.acrossRuns.runCountByKind).toEqual({ 'evaluation-fixture': corpus.fixtures.length });
        expect(record.sources.evaluationFixturesRead).toBe(corpus.fixtures.length);
    });
});

describe("the evaluation command's own exit code", () => {
    it('should return the nonzero exit when a label did not hold', async () => {
        // The command's own `return exitCodeFor(result)`: every other case reads the pure helper or the
        // success path, so a command that answered a held run's code whatever the run found would keep
        // them all green. The stub fires the label-retarget negative's rule, which is the disagreement the
        // one live run recorded, and the documented exit table gives that 1.
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const firedNegativePath = fixtureOf(corpus, 'grid-label-retarget').path;
        const exitCode = await runEvaluationCommand({
            argv: [],
            sourceFor: planForAll(),
            portsFor: () => ({
                provider: stubProvider(({ ruleId, path }) => {
                    if (positives.get(path) === ruleId) {
                        return 0.95;
                    }
                    return path === firedNegativePath && ruleId === 'assertion_deleted' ? 0.72 : 0.02;
                }).port,
                cache: createMemoryCache(),
                clock: { now: () => 1_700_000_000_000 },
                signal: new AbortController().signal,
                log: () => undefined,
            }),
            log: () => undefined,
        });
        expect(exitCode).toBe(1);
    });
});

describe("the evaluation command's refusal exits", () => {
    it('should return the invalid-invocation exit when the invocation is refused', async () => {
        // The command's catch, through the refusal it is most likely to hold: `parseEvaluationArgs`
        // refuses an unsupported profile before the corpus is read or a port is built, and `failureExit`
        // answers the documented invalid-invocation code. A catch that answered the success code whatever
        // it caught would let a misspelled invocation report a delivered evaluation.
        const exitCode = await runEvaluationCommand({
            argv: ['--profile', 'extended'],
            sourceFor: planForAll(),
            portsFor: () => ({
                provider: stubProvider(() => 0.02).port,
                cache: createMemoryCache(),
                clock: { now: () => 1_700_000_000_000 },
                signal: new AbortController().signal,
                log: () => undefined,
            }),
            log: () => undefined,
        });
        expect(exitCode).toBe(2);
    });

    it('should return the provider-incomplete exit when the provider cannot be built', async () => {
        // What the entry point does with no TypeSafe key: `loadApiKey` refuses with `missing_credentials`
        // while the ports are built, so no request is ever made. The failure is a `SemanticFailure` whose
        // code is neither invocation nor response, which is the documented "the provider did not deliver
        // an assessment" code.
        const exitCode = await runEvaluationCommand({
            argv: [],
            sourceFor: planForAll(),
            portsFor: () => {
                throw new SemanticFailure('missing_credentials', 'no TypeSafe key in the environment');
            },
            log: () => undefined,
        });
        expect(exitCode).toBe(3);
    });

    it('should return the incomplete exit when the provider delivers nothing at all', async () => {
        // A total outage: every request fails, so no fixture is assessed and no label was ever asked. Both
        // conditions hold at once here — nothing was delivered *and* no label held — which is the point of
        // the priority: the exit names the non-delivery, and reading the mismatch first reports an
        // infrastructure outcome as a label that disagreed with its recording.
        const corpus = shippedCorpus();
        const outage = (): SemanticProviderPort =>
            stubProvider(() => {
                throw new SemanticFailure('provider_unavailable', 'the provider refused every request');
            }).port;
        const result = await evaluateWith(corpus, outage());
        expect(result.expectationsHeld).toBe(0);
        expect(result.outcomes.every((outcome) => outcome.expectedConcernHeld)).toBe(false);
        expect(result.outcomes.every((outcome) => outcome.execution !== 'completed')).toBe(true);
        expect(exitCodeFor(result)).toBe(3);
        const exitCode = await runEvaluationCommand({
            argv: [],
            sourceFor: planForAll(),
            portsFor: () => ({
                provider: outage(),
                cache: createMemoryCache(),
                clock: { now: () => 1_700_000_000_000 },
                signal: new AbortController().signal,
                log: () => undefined,
            }),
            log: () => undefined,
        });
        expect(exitCode).toBe(3);
    });

    it('should return the incomplete exit when a provider failure leaves part of a run undelivered', async () => {
        // Non-delivery outranking the held labels, not only the disagreed ones: this run asked and held
        // every label it assessed, and one fixture's second changed file was never assessed. A success code
        // here would report a scope the run did not deliver. The shipped corpus's own fixture shape cannot
        // produce the state — a fixture whose own unit fails carries no held label either, so it reads as
        // non-delivery too — which is why this case gives one fixture the two-path shape a revision pair
        // can have and fails only the second path's request.
        const corpus = shippedCorpus();
        const positives = positiveRules(corpus);
        const undeliveredPath = 'src/modules/Arrangement/useCases/__tests__/zzUndelivered.spec.ts';
        const exitCode = await runEvaluationCommand({
            argv: [],
            sourceFor: planWithOneSource('descriptor-hash-retarget', (fixture) =>
                standInSource(fixture, undeliveredPath)
            ),
            portsFor: () => ({
                provider: stubProvider(({ ruleId, path }) => {
                    if (path === undeliveredPath) {
                        throw new SemanticFailure('provider_unavailable', 'the provider did not answer this file');
                    }
                    return positives.get(path) === ruleId ? 0.95 : 0.02;
                }).port,
                cache: createMemoryCache(),
                clock: { now: () => 1_700_000_000_000 },
                signal: new AbortController().signal,
                log: () => undefined,
            }),
            log: () => undefined,
        });
        expect(exitCode).toBe(3);
    });
});

describe('the live command line is opt-in', () => {
    it('should default to the profile the advisory review runs under and honour the documented options', () => {
        expect(parseEvaluationArgs([])).toEqual({
            profile: 'ci',
            corpusPath: SEMANTIC_EVALUATION_CORPUS_PATH,
        });
        expect(parseEvaluationArgs(['--profile', 'local'])).toEqual({
            profile: 'local',
            corpusPath: SEMANTIC_EVALUATION_CORPUS_PATH,
        });
        expect(parseEvaluationArgs(['--out', '/tmp/outcomes.json']).outPath).toBe('/tmp/outcomes.json');
        expect(() => parseEvaluationArgs(['--profile', 'extended'])).toThrow(SemanticFailure);
        expect(() => parseEvaluationArgs(['--nope'])).toThrow(SemanticFailure);
    });

    it('should refuse a unit test, a CI run, and nothing else', () => {
        // Both refusals are pinned with their own environment rather than the ambient one: under CI this
        // suite runs with `CI` set, and reading `process.env` here asserted whichever message happened to
        // win the order instead of the refusal each condition owes.
        expect(() => assertEvaluationIsOptIn({ VITEST: 'true' })).toThrow(/never run from a unit test/u);
        expect(() => assertEvaluationIsOptIn({ CI: 'true' })).toThrow(/never runs in CI/u);
        expect(() => assertEvaluationIsOptIn({ CI: 'true', VITEST: 'true' })).toThrow(/never run from a unit test/u);
        expect(() => assertEvaluationIsOptIn({})).not.toThrow();
        expect(() => assertEvaluationIsOptIn({ CI: 'false' })).not.toThrow();
    });
});
