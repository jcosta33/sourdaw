/**
 * The deterministic change-facts block: what it classifies, how it is bounded, and that a request carries
 * it under an identity a fact change cannot reuse.
 *
 * These are the pins that keep the two audited false alarms from coming back through a wording change: the
 * block must count exactly the lines a diff added and removed that carry an assertion or introduce control
 * flow, it must say `unavailable` rather than zero when nothing was read, and it must be part of the state
 * the response cache keys on.
 */

import { describe, expect, it } from 'vitest';

import {
    CHANGED_LINE_FACTS_LINE_LIMIT,
    changedLineFacts,
    isAssertionLine,
    isControlFlowLine,
    type PathChangedLines,
    type UnitChangedLineFacts,
} from '../changeFacts.ts';
import { collectEvidence, type SemanticChangedFile, type SemanticSourcePort } from '../evidence.ts';
import { passRequestPayload } from '../passes.ts';
import { computeResponseCacheKey, TYPESAFE_MODEL } from '../provider.ts';
import { unitStatePlusQuestionBytes } from '../requestPayload.ts';
import { SEMANTIC_BUDGET_PROFILES } from '../rules.ts';
import { planUnits, type SemanticUnitPlan } from '../run.ts';

const MERGE_BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const PATH = 'src/modules/Arrangement/useCases/__tests__/setTrackGain.spec.ts';
const CAP = SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes;

const BEFORE = [
    "import { describe, expect, it } from 'vitest';",
    '',
    "describe('setTrackGain', () => {",
    "    it('ignores a non-finite gain', () => {",
    '        const track = { gain: 0.5 };',
    '        setTrackGain(track, Number.NaN);',
    '        expect(track.gain).toBe(0.5);',
    '    });',
    '});',
    '',
].join('\n');

const AFTER = [
    "import { describe, expect, it } from 'vitest';",
    '',
    "describe('setTrackGain', () => {",
    "    it('ignores a non-finite gain', () => {",
    '        const track = { gain: 0.5 };',
    '        setTrackGain(track, Number.NaN);',
    '        setTrackGain(track, Number.NEGATIVE_INFINITY);',
    '    });',
    '});',
    '',
].join('\n');

/** One removed assertion line and one added non-assertion line: the unit plans and both sides are sent. */
const CHANGED_LINES: PathChangedLines = {
    added: [{ line: 7, text: '        setTrackGain(track, Number.NEGATIVE_INFINITY);' }],
    removed: [{ line: 7, text: '        expect(track.gain).toBe(0.5);' }],
};

const EXPECTED_FACTS: UnitChangedLineFacts = {
    basis: 'unified-diff',
    before: { removedAssertions: { count: 1, lines: [7], truncated: false } },
    after: {
        addedAssertions: { count: 0, lines: [], truncated: false },
        addedControlFlow: { count: 0, lines: [], truncated: false },
    },
};

function fixtureSource(changedLines: ReadonlyMap<string, PathChangedLines>): SemanticSourcePort {
    const changedFile: SemanticChangedFile = {
        path: PATH,
        kind: 'modified',
        binary: false,
        generated: false,
        added: 1,
        deleted: 1,
    };
    return {
        changedFiles: () => [changedFile],
        readFile: (sha, path) => {
            if (path !== PATH) {
                return undefined;
            }
            if (sha === MERGE_BASE) {
                return BEFORE;
            }
            return sha === HEAD ? AFTER : undefined;
        },
        changedHunks: () =>
            new Map([
                [PATH, { path: PATH, before: [{ startLine: 3, endLine: 9 }], after: [{ startLine: 3, endLine: 9 }] }],
            ]),
        changedLines: () => changedLines,
    };
}

function plannedUnit(lines: ReadonlyMap<string, PathChangedLines>): SemanticUnitPlan {
    const source = fixtureSource(lines);
    const set = collectEvidence({
        port: source,
        mergeBaseSha: MERGE_BASE,
        headSha: HEAD,
        contractSourceSha: MERGE_BASE,
        limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
    });
    const { units } = planUnits([...source.changedFiles(MERGE_BASE, HEAD)], set, CAP);
    const unit = units[0];
    if (unit === undefined) {
        throw new Error('the fixture planned no unit, so the case would assert nothing');
    }
    return unit;
}

function unitPayload(
    unit: SemanticUnitPlan,
    changedLineFacts: UnitChangedLineFacts
): { state: Record<string, unknown>; questions: Record<string, unknown> } {
    const pass = unit.evidence.passes[0];
    if (pass === undefined) {
        throw new Error('the fixture composed no pass, so the case would assert nothing');
    }
    return passRequestPayload({
        unitId: unit.unitId,
        path: unit.path,
        file: unit.file,
        rules: unit.rules,
        pass,
        changedLineFacts,
    });
}

/** How many single-line hunks the saturation witness is sliced into. */
const WITNESS_REGIONS = 3;

/** The block one added spec of `WITNESS_REGIONS` lines reports: its first line carries an assertion head. */
const WITNESS_FACTS: UnitChangedLineFacts = {
    basis: 'unified-diff',
    before: { removedAssertions: { count: 0, lines: [], truncated: false } },
    after: {
        addedAssertions: { count: 1, lines: [1], truncated: false },
        addedControlFlow: { count: 0, lines: [], truncated: false },
    },
};

/**
 * One synthetic added spec whose after side is `WITNESS_REGIONS` single-line hunks, the last carrying
 * `padding` filler bytes, with the changed lines a real diff of that file would report. JSON escapes none
 * of the filler, so the unit's serialized evidence grows one byte per padding byte and the fitter's
 * admission boundary can be bisected with the fact block in place.
 */
function witnessSource(padding: number): SemanticSourcePort {
    const lines = [
        "        expect(screen.getByText('1/16')).toBeInTheDocument();",
        "    it('exposes the snap value control', async () => {",
        `        const filler = '${'p'.repeat(padding)}';`,
    ];
    const content = `${lines.join('\n')}\n`;
    return {
        changedFiles: () => [
            {
                path: PATH,
                kind: 'added',
                binary: false,
                generated: false,
                added: lines.length,
                deleted: 0,
            },
        ],
        readFile: (sha, path) => (path === PATH && sha === HEAD ? content : undefined),
        changedHunks: () =>
            new Map([
                [
                    PATH,
                    {
                        path: PATH,
                        before: [],
                        after: lines.map((_line, index) => ({ startLine: index + 1, endLine: index + 1 })),
                    },
                ],
            ]),
        changedLines: () =>
            new Map([[PATH, { added: lines.map((text, index) => ({ line: index + 1, text })), removed: [] }]]),
    };
}

/** The unit that fixture plans under `cap`, or undefined when its evidence is over the budget outright. */
function witnessUnit(padding: number, cap: number): SemanticUnitPlan | undefined {
    const source = witnessSource(padding);
    const set = collectEvidence({
        port: source,
        mergeBaseSha: MERGE_BASE,
        headSha: HEAD,
        contractSourceSha: MERGE_BASE,
        limits: { maxRegionBytes: 1_000_000, maxTotalBytes: 1_000_000 },
    });
    return planUnits([...source.changedFiles(MERGE_BASE, HEAD)], set, cap).units[0];
}

describe('a changed line is classified by its text alone', () => {
    it('should read the assertion calls these suites spell and not the words that merely start like them', () => {
        const assertions = [
            'expect(track.gain).toBe(1);',
            "expect(screen.getByText('1/4')).toBeInTheDocument();",
            'await expect(page.locator).toBeVisible();',
            'expect.soft(value).toEqual(2);',
            'expectExternalProjectLink(entry, slug);',
            'assert.deepStrictEqual(actual, expected);',
            'expect(result).not.toThrow();',
            // Session-scoped heads the framework ships beyond soft/poll: a removed one is a removed check,
            // and an allowlist of the heads that came to mind published no removed assertion for either.
            "expect.fail('the engine never became ready');",
            "expect.unreachable('the branch is impossible');",
            'expect.assertions(2);',
            'expect.hasAssertions();',
            'await expect.poll(() => count).toBe(3);',
        ];
        const notAssertions = [
            'expectations.push(value);',
            'const assertValue = 3;',
            'const assertionCount = 2;',
            'assertiveCopy.write(text);',
            // A matcher-shaped method on an ordinary receiver is not an assertion. These are the lines an
            // unanchored `.to[A-Za-z](` pattern published as removed assertions, which is the false alarm
            // this block exists to quiet.
            'const text = value.toString();',
            'const fixed = count.toFixed(2);',
            'const lower = name.toLowerCase();',
            'const stamp = date.toISOString();',
            'const localised = date.toLocaleDateString();',
            'const precise = ratio.toPrecision(3);',
            'const rows = table.toggleAllRowsSelected(true);',
            // `expect.<member>(` heads that are values, registration, or state rather than checks.
            'expect.objectContaining({ gain: 0.5 }),',
            'expect.any(String),',
            'expect.anything(),',
            'expect.arrayContaining([1, 2]),',
            "expect.stringContaining('snap'),",
            'expect.stringMatching(/^snap/u),',
            'expect.closeTo(0.25, 5),',
            'expect.extend({ toBeWithinRange() {} });',
            'expect.addSnapshotSerializer(plugin);',
            'expect.setState({ assertionCalls: 1 });',
        ];
        expect(assertions.filter(isAssertionLine)).toEqual(assertions);
        expect(notAssertions.filter(isAssertionLine)).toEqual([]);
    });

    it('should report no removed assertion for an edit that only removes a serialization call', () => {
        const facts = changedLineFacts({
            added: [],
            removed: [
                { line: 12, text: 'const stamp = date.toISOString();' },
                { line: 13, text: 'const text = payload.toString();' },
            ],
        });
        expect(facts).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 0, lines: [], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 0, lines: [], truncated: false },
            },
        });
    });

    it('should report a removed session-scoped head as a removed assertion', () => {
        const facts = changedLineFacts({
            added: [],
            removed: [
                { line: 41, text: "        expect.fail('the engine never became ready');" },
                { line: 44, text: "        expect.unreachable('the branch is impossible');" },
                { line: 47, text: '        expect.objectContaining({ gain: 0.5 }),' },
            ],
        });
        expect(facts).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 2, lines: [41, 44], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 0, lines: [], truncated: false },
            },
        });
    });

    it('should read the control-flow heads the rules name and a bare return, not a return with a value', () => {
        const controlFlow = [
            'if (!toolbar.mounted) {',
            '} else {',
            '} else if (ready) {',
            '} catch (error) {',
            'switch (mode) {',
            'throw new Error("absent");',
            'return;',
            '            return',
            'if (await locator.isVisible().catch(() => false)) {',
        ];
        const notControlFlow = ['return { snapValue: 1 };', 'return value;', 'const gifted = 1;', 'const catcher = 2;'];
        expect(controlFlow.filter(isControlFlowLine)).toEqual(controlFlow);
        expect(notControlFlow.filter(isControlFlowLine)).toEqual([]);
    });
});

describe('the block is bounded and deterministic', () => {
    const many: PathChangedLines = {
        added: Array.from({ length: CHANGED_LINE_FACTS_LINE_LIMIT + 3 }, (_unused, index) => ({
            line: index + 1,
            text: `        expect(value${String(index)}).toBe(${String(index)});`,
        })),
        removed: [],
    };

    it('should count every matching line and name only the bounded head of them', () => {
        const facts = changedLineFacts(many);
        expect(facts.basis).toBe('unified-diff');
        if (facts.basis !== 'unified-diff') {
            throw new Error('the block must be derived from the diff for this fixture');
        }
        expect(facts.after.addedAssertions.count).toBe(CHANGED_LINE_FACTS_LINE_LIMIT + 3);
        expect(facts.after.addedAssertions.lines).toHaveLength(CHANGED_LINE_FACTS_LINE_LIMIT);
        expect(facts.after.addedAssertions.truncated).toBe(true);
    });

    it('should be byte-identical for the same diff however the lines arrive', () => {
        const reordered: PathChangedLines = { added: [...many.added].reverse(), removed: [...many.removed] };
        expect(JSON.stringify(changedLineFacts(reordered))).toBe(JSON.stringify(changedLineFacts(many)));
    });

    it('should report unavailable rather than an empty edit when the source read no lines', () => {
        expect(changedLineFacts(undefined)).toEqual({ basis: 'unavailable' });
    });
});

describe('a unit request carries its own changed-line facts', () => {
    it('should carry the block in the unit record the questions read', () => {
        const unit = plannedUnit(new Map([[PATH, CHANGED_LINES]]));
        expect(unit.changedLineFacts).toEqual(EXPECTED_FACTS);
        const state = unitPayload(unit, unit.changedLineFacts).state as { unit: { changedLines: unknown } };
        expect(state.unit.changedLines).toEqual(EXPECTED_FACTS);
    });

    it('should leave the facts unavailable when the diff read nothing for this unit', () => {
        const unit = plannedUnit(new Map());
        expect(unit.changedLineFacts).toEqual({ basis: 'unavailable' });
        const state = unitPayload(unit, unit.changedLineFacts).state as { unit: { changedLines: unknown } };
        expect(state.unit.changedLines).toEqual({ basis: 'unavailable' });
    });

    it('should key the facts to the unit that owns the lines, not to whatever the change touched', () => {
        const elsewhere = 'src/modules/Other/useCases/__tests__/somewhereElse.spec.ts';
        const unit = plannedUnit(new Map([[elsewhere, CHANGED_LINES]]));
        expect(unit.changedLineFacts).toEqual({ basis: 'unavailable' });
    });

    it('should reserve the facts with the unit so a saturated plan still measures inside the state cap', () => {
        // The witness this case exists for: the reservation is the planner's own number, so a reservation
        // that ignored the facts would admit exactly the facts' bytes of extra evidence and the largest
        // sent pass would then measure over the cap. The fixture is bisected to the deepest padding whose
        // regions the plan still carries whole, which is the boundary where that slack has nowhere to hide.
        const cap = SEMANTIC_BUDGET_PROFILES.ci.maxStatePlusQuestionBytes;
        const padded = (padding: number): SemanticUnitPlan | undefined => witnessUnit(padding, cap);
        const carriesWholeUnit = (padding: number): boolean => padded(padding)?.evidence.own.length === WITNESS_REGIONS;
        let low = 0;
        let high = cap;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (carriesWholeUnit(middle)) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        const unit = padded(low);
        if (unit === undefined) {
            throw new Error('the fixture planned no unit, so the case would assert nothing');
        }
        expect(unit.changedLineFacts).toEqual(WITNESS_FACTS);
        expect(unit.evidence.own).toHaveLength(WITNESS_REGIONS);
        // One more byte of evidence does not fit, so the budget is genuinely spent and the measurement
        // below is taken at the boundary rather than with slack the reservation could be hiding in.
        expect(carriesWholeUnit(low + 1)).toBe(false);
        const largestSentPass = Math.max(
            ...unit.evidence.passes.map((pass) =>
                unitStatePlusQuestionBytes({
                    unitId: unit.unitId,
                    path: unit.path,
                    file: unit.file,
                    rules: unit.rules,
                    evidence: { references: pass.references, contents: pass.contents },
                    changedLineFacts: unit.changedLineFacts,
                })
            )
        );
        expect(largestSentPass).toBeLessThanOrEqual(cap);
    });

    it('should answer a changed fact with a different cache identity', () => {
        const unit = plannedUnit(new Map([[PATH, CHANGED_LINES]]));
        const withBranch: UnitChangedLineFacts = {
            ...EXPECTED_FACTS,
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 1, lines: [7], truncated: false },
            },
        };
        expect(computeResponseCacheKey({ ...unitPayload(unit, withBranch), model: TYPESAFE_MODEL })).not.toBe(
            computeResponseCacheKey({ ...unitPayload(unit, unit.changedLineFacts), model: TYPESAFE_MODEL })
        );
    });
});
