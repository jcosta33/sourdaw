/**
 * The adjudicated evaluation corpus for the advisory semantic review: the changes the review must not
 * alarm on, and the changes it must.
 *
 * Why a corpus and not a threshold tweak. The audit of this repository's own advisory reviews found
 * `assertion_deleted` and `admission_branch_completes_without_asserting` firing on revisions that do not
 * commit the alleged defect. Two of those revisions are real, and they are recorded here as adjudicated
 * negatives beside authored synthetic positives that carry the defect for real, so a change to the rules,
 * the requests, or the deterministic change facts can be read against labelled cases instead of against
 * one number.
 *
 * What a label is. Every label is a human adjudication about what the change does. No model score is
 * recorded anywhere in the corpus, and a provider run over these fixtures is evidence about the provider,
 * never about a label.
 *
 * The corpus verifies itself where it can. The shipped rule must actually apply to the fixture's path, a
 * synthetic fixture's declared changed lines must be the lines its own text holds, and the recorded
 * change-facts block must be exactly what the shipped classifier derives from the recorded lines. The two
 * adjudicated negatives carry lines recorded from the real revisions rather than their text, so the live
 * runner re-derives them from Git and reports any drift.
 */

import { join } from 'node:path';

import { changedLineFacts, type PathChangedLines, type UnitChangedLineFacts } from '../changeFacts.ts';
import { refuse, type EvidenceSide } from '../contracts.ts';
import { SEMANTIC_RULES, type SemanticRuleId } from '../rules.ts';

import type { LineRange, PathHunks, SemanticSourcePort } from '../evidence.ts';

export const SEMANTIC_EVALUATION_CORPUS_FORMAT = 'semantic-evaluation-corpus-v1';

/**
 * The path the shipped corpus is read from, resolved beside this module rather than from the caller's
 * working directory. `import.meta.dirname` rather than a `file:` URL because the suite transforms
 * `import.meta.url` to a served path, and a module constant must resolve in both places.
 */
export const SEMANTIC_EVALUATION_CORPUS_PATH = join(import.meta.dirname, 'semanticEvaluationCorpus.json');

/**
 * The revision pair a synthetic fixture carries. No Git object is all zeroes or all `f`s, so a fixture
 * built from a corpus text can never be mistaken for an assessment of a revision, and the two sides stay
 * distinguishable because the source reads its before text at one and its after text at the other.
 */
export const SYNTHETIC_FIXTURE_REVISIONS = {
    mergeBaseSha: '0'.repeat(40),
    headSha: 'f'.repeat(40),
} as const;

export type EvaluationFixtureKind = 'adjudicated-negative' | 'synthetic-positive';

/** The expectation a fixture carries: the rule applies, and its concern is either absent or the rule. */
export type EvaluationExpectation = {
    readonly applies: true;
    readonly concern: 'none' | SemanticRuleId;
};

type EvaluationFixtureBase = {
    readonly id: string;
    readonly path: string;
    readonly ruleId: SemanticRuleId;
    readonly revisions: { readonly mergeBaseSha: string; readonly headSha: string };
    readonly expected: EvaluationExpectation;
    /** One line saying why this change is or is not the defect the rule names. */
    readonly adjudication: string;
    /** Where the adjudication came from, so a cold reader can weigh it. */
    readonly adjudicatedFrom: string;
    /** The paired fixture for the other half of this rule's evidence: a positive for a negative. */
    readonly pairedWith: string;
    /** The added and removed lines the fixture's change consists of, as the diff reports them. */
    readonly changedLines: PathChangedLines;
    /** The block the shipped classifier derives from `changedLines`; checked to equal it on parse. */
    readonly changedLineFacts: UnitChangedLineFacts;
};

/** A real revision pair a human adjudicated as not committing the defect the rule under test names. */
export type AdjudicatedNegative = EvaluationFixtureBase & { readonly fixture: 'adjudicated-negative' };

/** An authored change that commits the defect for real. Its text is the fixture; it is not a revision. */
export type SyntheticPositive = EvaluationFixtureBase & {
    readonly fixture: 'synthetic-positive';
    readonly source: { readonly before: string; readonly after: string };
    readonly hunks: { readonly before: readonly LineRange[]; readonly after: readonly LineRange[] };
};

export type EvaluationFixture = AdjudicatedNegative | SyntheticPositive;

export type EvaluationCorpus = {
    readonly format: string;
    readonly labelBasis: string;
    readonly labelNote: string;
    readonly fixtures: readonly EvaluationFixture[];
};

const RULE_IDS: ReadonlySet<string> = new Set(SEMANTIC_RULES.map((rule) => rule.id));
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('unsupported_scope', `${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        refuse('unsupported_scope', `${label} must be a non-empty string`);
    }
    return value;
}

function asArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        refuse('unsupported_scope', `${label} must be an array`);
    }
    return value;
}

function asSha(value: unknown, label: string): string {
    const sha = asString(value, label);
    if (!SHA_PATTERN.test(sha)) {
        refuse('unsupported_scope', `${label} must be a full 40-hex commit sha`);
    }
    return sha;
}

function asLineRange(value: unknown, label: string): LineRange {
    const range = asRecord(value, label);
    const startLine = range.startLine;
    const endLine = range.endLine;
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) {
        refuse('unsupported_scope', `${label} must carry integer startLine and endLine`);
    }
    const start = startLine as number;
    const end = endLine as number;
    if (start < 1 || end < start) {
        refuse('unsupported_scope', `${label} has an impossible range ${String(start)}-${String(end)}`);
    }
    return { startLine: start, endLine: end };
}

function parseChangedLines(value: unknown, label: string): PathChangedLines {
    const record = asRecord(value, label);
    const side = (entries: unknown, sideLabel: string): readonly { line: number; text: string }[] =>
        asArray(entries, sideLabel).map((entry, index) => {
            const line = asRecord(entry, `${sideLabel}[${String(index)}]`);
            const number = line.line;
            if (!Number.isSafeInteger(number) || (number as number) < 1) {
                refuse('unsupported_scope', `${sideLabel}[${String(index)}] must carry a positive line number`);
            }
            return { line: number as number, text: asString(line.text, `${sideLabel}[${String(index)}].text`) };
        });
    return {
        added: side(record.added, `${label}.added`),
        removed: side(record.removed, `${label}.removed`),
    };
}

/** The text's lines, 1-based, with a trailing newline not counted as a line of its own. */
function textLines(text: string): string[] {
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    return body.split('\n');
}

/**
 * Checks one synthetic fixture's declared lines against its own text and hunk ranges, so a fixture that
 * drifts from its text fails at parse rather than being scored as a change it no longer describes.
 */
function assertSyntheticFixtureConsistent(fixture: SyntheticPositive): void {
    const before = textLines(fixture.source.before);
    const after = textLines(fixture.source.after);
    if (fixture.source.before === fixture.source.after) {
        refuse('unsupported_scope', `fixture ${fixture.id} has identical before and after text`);
    }
    const checkSide = (
        lines: readonly { readonly line: number; readonly text: string }[],
        text: readonly string[],
        ranges: readonly LineRange[],
        side: EvidenceSide
    ): void => {
        for (const line of lines) {
            const actual = text[line.line - 1];
            if (actual === undefined) {
                refuse(
                    'unsupported_scope',
                    `fixture ${fixture.id} names ${side} line ${String(line.line)} beyond its text`
                );
            }
            if (actual !== line.text) {
                refuse(
                    'unsupported_scope',
                    `fixture ${fixture.id} declares ${side} line ${String(line.line)} as ${JSON.stringify(line.text)} but its text holds ${JSON.stringify(actual)}`
                );
            }
            if (!ranges.some((range) => line.line >= range.startLine && line.line <= range.endLine)) {
                refuse(
                    'unsupported_scope',
                    `fixture ${fixture.id} names ${side} line ${String(line.line)} outside its declared hunks`
                );
            }
        }
    };
    for (const range of fixture.hunks.before) {
        if (range.endLine > before.length) {
            refuse('unsupported_scope', `fixture ${fixture.id} has a before hunk beyond its text`);
        }
    }
    for (const range of fixture.hunks.after) {
        if (range.endLine > after.length) {
            refuse('unsupported_scope', `fixture ${fixture.id} has an after hunk beyond its text`);
        }
    }
    checkSide(fixture.changedLines.removed, before, fixture.hunks.before, 'before');
    checkSide(fixture.changedLines.added, after, fixture.hunks.after, 'after');
}

function parseFixture(value: unknown, index: number): EvaluationFixture {
    const label = `corpus fixture ${String(index)}`;
    const record = asRecord(value, label);
    const id = asString(record.id, `${label}.id`);
    const kind = asString(record.fixture, `${label}.fixture`);
    if (kind !== 'adjudicated-negative' && kind !== 'synthetic-positive') {
        refuse('unsupported_scope', `${label}.fixture must be adjudicated-negative or synthetic-positive`);
    }
    const path = asString(record.path, `${label}.path`);
    const ruleId = asString(record.ruleId, `${label}.ruleId`);
    if (!RULE_IDS.has(ruleId)) {
        refuse('unsupported_scope', `${label}.ruleId ${ruleId} is not a shipped rule`);
    }
    // The expectation is checked against the shipped rule set rather than trusted: a corpus that claimed a
    // rule applies to a path it no longer admits would grade a run against a question nobody asks.
    const rule = SEMANTIC_RULES.find((candidate) => candidate.id === ruleId);
    if (rule?.appliesTo(path) !== true) {
        refuse('unsupported_scope', `${label}: rule ${ruleId} does not apply to ${path}`);
    }
    const expectedRecord = asRecord(record.expected, `${label}.expected`);
    if (expectedRecord.applies !== true) {
        refuse(
            'unsupported_scope',
            `${label}.expected.applies must be true: a fixture no rule admits is not a fixture`
        );
    }
    const concern = asString(expectedRecord.concern, `${label}.expected.concern`);
    if (concern !== 'none' && !RULE_IDS.has(concern)) {
        refuse('unsupported_scope', `${label}.expected.concern ${concern} is neither none nor a shipped rule`);
    }
    const revisions = asRecord(record.revisions, `${label}.revisions`);
    const mergeBaseSha = asSha(revisions.mergeBaseSha, `${label}.revisions.mergeBaseSha`);
    const headSha = asSha(revisions.headSha, `${label}.revisions.headSha`);
    const changedLines = parseChangedLines(record.changedLines, `${label}.changedLines`);
    const recordedFacts = record.changedLineFacts;
    const derivedFacts = changedLineFacts(changedLines);
    if (JSON.stringify(recordedFacts) !== JSON.stringify(derivedFacts)) {
        refuse(
            'unsupported_scope',
            `${label}.changedLineFacts is not what the shipped classifier derives from its changedLines`
        );
    }
    const base: EvaluationFixtureBase = {
        id,
        path,
        ruleId: ruleId as SemanticRuleId,
        revisions: { mergeBaseSha, headSha },
        expected: { applies: true, concern: concern as 'none' | SemanticRuleId },
        adjudication: asString(record.adjudication, `${label}.adjudication`),
        adjudicatedFrom: asString(record.adjudicatedFrom, `${label}.adjudicatedFrom`),
        pairedWith: asString(record.pairedWith, `${label}.pairedWith`),
        changedLines,
        changedLineFacts: derivedFacts,
    };
    if (kind === 'adjudicated-negative') {
        if (concern !== 'none') {
            refuse('unsupported_scope', `${label}: an adjudicated negative may not carry a concern`);
        }
        if (mergeBaseSha === headSha) {
            refuse('unsupported_scope', `${label}: the two revisions of a negative must differ`);
        }
        if (
            mergeBaseSha === SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha ||
            headSha === SYNTHETIC_FIXTURE_REVISIONS.headSha
        ) {
            refuse('unsupported_scope', `${label}: a negative carries real revisions, not the synthetic pair`);
        }
        return { ...base, fixture: 'adjudicated-negative' };
    }
    if (concern !== ruleId) {
        refuse('unsupported_scope', `${label}: a synthetic positive must carry its rule as the expected concern`);
    }
    if (mergeBaseSha !== SYNTHETIC_FIXTURE_REVISIONS.mergeBaseSha || headSha !== SYNTHETIC_FIXTURE_REVISIONS.headSha) {
        refuse('unsupported_scope', `${label}: a synthetic positive carries the synthetic revision pair`);
    }
    const sourceRecord = asRecord(record.source, `${label}.source`);
    const hunksRecord = asRecord(record.hunks, `${label}.hunks`);
    const fixture: SyntheticPositive = {
        ...base,
        fixture: 'synthetic-positive',
        source: {
            before: asString(sourceRecord.before, `${label}.source.before`),
            after: asString(sourceRecord.after, `${label}.source.after`),
        },
        hunks: {
            before: asArray(hunksRecord.before, `${label}.hunks.before`).map((range, rangeIndex) =>
                asLineRange(range, `${label}.hunks.before[${String(rangeIndex)}]`)
            ),
            after: asArray(hunksRecord.after, `${label}.hunks.after`).map((range, rangeIndex) =>
                asLineRange(range, `${label}.hunks.after[${String(rangeIndex)}]`)
            ),
        },
    };
    assertSyntheticFixtureConsistent(fixture);
    return fixture;
}

/**
 * Every fixture must be paired with a fixture of the opposite kind for the same rule: a negative says the
 * rule must stay quiet about a change that does not commit the defect, and only a positive that does
 * commit it shows the rule has not simply stopped asking.
 */
function assertPairing(fixtures: readonly EvaluationFixture[]): void {
    for (const fixture of fixtures) {
        const partner = fixtures.find((candidate) => candidate.id === fixture.pairedWith);
        if (partner === undefined) {
            refuse('unsupported_scope', `fixture ${fixture.id} pairs with unknown fixture ${fixture.pairedWith}`);
        }
        if (partner.ruleId !== fixture.ruleId) {
            refuse('unsupported_scope', `fixture ${fixture.id} pairs with a fixture of another rule`);
        }
        if (partner.fixture === fixture.fixture) {
            refuse('unsupported_scope', `fixture ${fixture.id} must pair with a fixture of the opposite kind`);
        }
        if (partner.pairedWith !== fixture.id) {
            refuse('unsupported_scope', `fixture ${fixture.id} and ${partner.id} are not paired with each other`);
        }
    }
}

/** Parses and validates one corpus document. Every structural refusal names the fixture it came from. */
export function parseEvaluationCorpus(value: unknown, label: string): EvaluationCorpus {
    const record = asRecord(value, label);
    const format = asString(record.format, `${label}.format`);
    if (format !== SEMANTIC_EVALUATION_CORPUS_FORMAT) {
        refuse('unsupported_scope', `${label}.format must be ${SEMANTIC_EVALUATION_CORPUS_FORMAT}`);
    }
    const fixtures = asArray(record.fixtures, `${label}.fixtures`).map((fixture, index) =>
        parseFixture(fixture, index)
    );
    if (fixtures.length === 0) {
        refuse('unsupported_scope', `${label}.fixtures must hold at least one fixture`);
    }
    const ids = new Set<string>();
    for (const fixture of fixtures) {
        if (ids.has(fixture.id)) {
            refuse('unsupported_scope', `${label} repeats the fixture id ${fixture.id}`);
        }
        ids.add(fixture.id);
    }
    assertPairing(fixtures);
    return {
        format,
        labelBasis: asString(record.labelBasis, `${label}.labelBasis`),
        labelNote: asString(record.labelNote, `${label}.labelNote`),
        fixtures,
    };
}

/**
 * A source port over one synthetic fixture's own text, hunks, and changed lines. The revision arguments
 * are ignored: the fixture's before text is what its merge base holds and its after text what its head
 * holds, and those two are the synthetic pair the corpus declares.
 */
export function syntheticFixtureSource(fixture: SyntheticPositive): SemanticSourcePort {
    const changedFile = {
        path: fixture.path,
        kind: 'modified' as const,
        binary: false,
        generated: false,
        added: fixture.changedLines.added.length,
        deleted: fixture.changedLines.removed.length,
    };
    const hunks: PathHunks = {
        path: fixture.path,
        before: fixture.hunks.before,
        after: fixture.hunks.after,
    };
    return {
        changedFiles: () => [changedFile],
        readFile: (sha, path) => {
            if (path !== fixture.path) {
                return undefined;
            }
            if (sha === fixture.revisions.mergeBaseSha) {
                return fixture.source.before;
            }
            return sha === fixture.revisions.headSha ? fixture.source.after : undefined;
        },
        changedHunks: () => new Map([[fixture.path, hunks]]),
        changedLines: () => new Map([[fixture.path, fixture.changedLines]]),
    };
}

/**
 * A real source port restricted to one fixture's path, which is the path the diff keys that file's hunks
 * and lines by. The corpus is one change per fixture, and a scan over the whole revision pair would
 * assess every file the pair touched; restricting it keeps the run's scope the fixture it is grading
 * while every region still comes from Git.
 */
export function restrictSourceToPath(port: SemanticSourcePort, path: string): SemanticSourcePort {
    return {
        changedFiles: (mergeBaseSha, headSha) =>
            port.changedFiles(mergeBaseSha, headSha).filter((file) => file.path === path),
        readFile: (sha, readPath) => port.readFile(sha, readPath),
        changedHunks: (mergeBaseSha, headSha) => {
            const restricted = new Map<string, PathHunks>();
            const hunks = port.changedHunks(mergeBaseSha, headSha).get(path);
            if (hunks !== undefined) {
                restricted.set(path, hunks);
            }
            return restricted;
        },
        changedLines: (mergeBaseSha, headSha) => {
            const restricted = new Map<string, PathChangedLines>();
            const lines = port.changedLines(mergeBaseSha, headSha).get(path);
            if (lines !== undefined) {
                restricted.set(path, lines);
            }
            return restricted;
        },
    };
}
