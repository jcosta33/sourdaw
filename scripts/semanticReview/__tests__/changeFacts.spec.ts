/**
 * The deterministic change-facts block: what it classifies, how it is bounded, and that a request carries
 * it under an identity a fact change cannot reuse.
 *
 * These are the pins that keep the two audited false alarms from coming back through a wording change: the
 * block must count exactly the lines a diff added and removed that carry an assertion or introduce control
 * flow, it must say `unavailable` rather than zero when nothing was read, and it must be part of the state
 * the response cache keys on.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    CHANGED_LINE_FACTS_LINE_LIMIT,
    changedLineFacts,
    isAssertionLine,
    isControlFlowLine,
    NON_ASSERTION_EXPECT_MEMBERS,
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

/**
 * Every framework this repository's specs run on, with the package that *declares* its expect surface and
 * the interfaces that declare its asymmetric matchers. `@playwright/test` re-exports `playwright/test`, so
 * resolving the playwright package is what finds the interface the end-to-end specs' `expect` carries.
 */
const MATCHER_DECLARATION_SOURCES: readonly {
    readonly framework: string;
    readonly packageName: string;
    readonly directories: readonly string[];
    readonly interfaces: readonly string[];
}[] = [
    {
        framework: 'vitest',
        packageName: 'vitest',
        directories: ['dist'],
        interfaces: ['AsymmetricMatchersContaining', 'CustomMatcher'],
    },
    { framework: 'playwright', packageName: 'playwright', directories: ['types'], interfaces: ['AsymmetricMatchers'] },
];

/** Every declaration file one installed framework ships under the given directories. */
function declarationTexts(packageName: string, directories: readonly string[]): string[] {
    const packageFile = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
    const texts: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(path);
                continue;
            }
            if (entry.name.endsWith('.d.ts')) {
                texts.push(readFileSync(path, 'utf8'));
            }
        }
    };
    for (const directory of directories) {
        walk(join(dirname(packageFile), directory));
    }
    return texts;
}

/**
 * The brace-delimited body one declaration opens at `open`, or undefined when its braces never balance.
 * The walk is shared by the interface and type-alias readers because both spell their members the same
 * way once the body is found; only how the body starts differs.
 */
function declarationBody(declaration: string, open: number): string | undefined {
    let depth = 0;
    for (let index = open; index < declaration.length; index += 1) {
        const character = declaration[index];
        if (character === '{') {
            depth += 1;
            continue;
        }
        if (character === '}') {
            depth -= 1;
            if (depth === 0) {
                return declaration.slice(open + 1, index);
            }
        }
    }
    return undefined;
}

/**
 * The members one declaration body contributes: its shallowest-indented `name:`/`name(` declarations,
 * which is the declaration's own surface. A nested object type's members sit deeper, and the shipped
 * vitest declarations indent members with a tab and playwright's with two spaces, so the depth is
 * measured per declaration rather than assumed.
 */
function declaredMembers(body: string): string[] {
    const declared = [...body.matchAll(/^([ \t]*)([A-Za-z_$][A-Za-z0-9_$]*)\s*[:(]/gmu)];
    if (declared.length === 0) {
        return [];
    }
    const shallowest = Math.min(...declared.map((match) => (match[1] ?? '').length));
    return declared.filter((match) => (match[1] ?? '').length === shallowest).map((match) => match[2] ?? '');
}

/** The members one declared interface contributes, in every file that declares it. */
function declaredInterfaceMembers(declarations: readonly string[], name: string): string[] {
    const members = new Set<string>();
    for (const declaration of declarations) {
        const start = declaration.indexOf(`interface ${name}`);
        if (start === -1) {
            continue;
        }
        const open = declaration.indexOf('{', start);
        if (open === -1) {
            continue;
        }
        const body = declarationBody(declaration, open);
        for (const member of body === undefined ? [] : declaredMembers(body)) {
            members.add(member);
        }
    }
    return [...members];
}

/**
 * The members one declared type alias contributes, for the surface a framework spells as an alias over an
 * object type rather than an interface: playwright declares its expect as
 * `type Expect<ExtendedMatchers = {}> = { … } & AsymmetricMatchers`. Angle brackets are tracked so the
 * generic default's own braces are not read as the alias body.
 */
function declaredTypeAliasMembers(declarations: readonly string[], name: string): string[] {
    const members = new Set<string>();
    for (const declaration of declarations) {
        const start = new RegExp(`\\btype\\s+${name}\\b`, 'u').exec(declaration)?.index;
        if (start === undefined) {
            continue;
        }
        let angleDepth = 0;
        let open: number | undefined;
        for (let index = start; index < declaration.length; index += 1) {
            const character = declaration[index];
            if (character === '<') {
                angleDepth += 1;
                continue;
            }
            if (character === '>') {
                angleDepth -= 1;
                continue;
            }
            if (character === '{' && angleDepth === 0) {
                open = index;
                break;
            }
        }
        if (open === undefined) {
            continue;
        }
        const body = declarationBody(declaration, open);
        for (const member of body === undefined ? [] : declaredMembers(body)) {
            members.add(member);
        }
    }
    return [...members];
}

/** Every asymmetric matcher each installed framework declares, keyed by framework. */
function installedMatcherSurfaces(): Record<string, string[]> {
    return Object.fromEntries(
        MATCHER_DECLARATION_SOURCES.map((source) => {
            const declarations = declarationTexts(source.packageName, source.directories);
            return [
                source.framework,
                source.interfaces.flatMap((name) => declaredInterfaceMembers(declarations, name)),
            ];
        })
    );
}

/**
 * Every framework this repository's specs run on, with the declaration that carries its `expect` object's
 * own members: vitest's `ExpectStatic` interface and playwright's `Expect` type alias.
 */
const EXPECT_DECLARATION_SOURCES: readonly {
    readonly framework: string;
    readonly packageName: string;
    readonly directories: readonly string[];
    readonly interfaces: readonly string[];
    readonly typeAliases: readonly string[];
}[] = [
    {
        framework: 'vitest',
        packageName: 'vitest',
        directories: ['dist'],
        interfaces: ['ExpectStatic'],
        typeAliases: [],
    },
    {
        framework: 'playwright',
        packageName: 'playwright',
        directories: ['types'],
        interfaces: [],
        typeAliases: ['Expect'],
    },
];

/** Every member each installed framework declares on `expect` itself, keyed by framework. */
function installedExpectSurfaces(): Record<string, string[]> {
    return Object.fromEntries(
        EXPECT_DECLARATION_SOURCES.map((source) => {
            const declarations = declarationTexts(source.packageName, source.directories);
            return [
                source.framework,
                [
                    ...source.interfaces.flatMap((name) => declaredInterfaceMembers(declarations, name)),
                    ...source.typeAliases.flatMap((name) => declaredTypeAliasMembers(declarations, name)),
                ],
            ];
        })
    );
}

/**
 * The `expect.<member>(` heads that configure, register, or report rather than check, pinned by name
 * because the declarations do not separate the kinds: vitest declares `assertions: (expected: number) =>
 * void` beside `addEqualityTesters: (testers: Array<Tester>) => void`, and a call to either returns
 * nothing to read. The case below derives each framework's `expect` surface and requires every name here
 * to be declared on one of them, so this list cannot outlive the helpers it claims are shipped.
 */
const EXPECT_HELPER_MEMBERS: readonly string[] = [
    'addEqualityTesters',
    'addSnapshotSerializer',
    'configure',
    'extend',
    'getState',
    'setState',
];

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
            // Matcher values the frameworks ship beyond the containing helpers.
            'expect.toBeOneOf([1, 2]),',
            'expect.toSatisfy((value) => value > 0),',
            'expect.arrayOf(Example),',
            'expect.extend({ toBeWithinRange() {} });',
            'expect.addSnapshotSerializer(plugin);',
            'expect.setState({ assertionCalls: 1 });',
            // Helpers the asymmetric-matcher derivation cannot reach: they are declared on the frameworks'
            // own `expect` surfaces, where a check and a helper are spelled the same way.
            'expect.configure({ timeout: 5000 });',
            'expect.getState().assertionCalls,',
            'expect.addEqualityTesters([tester]);',
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

    it('should report a head split from its call as one assertion on both lines', () => {
        // The repository's own split spelling, twice in one AiRuntime spec: `expect` on one line and
        // `.soft(result.actions)` on the next. Neither line alone is an assertion, so a removed soft check
        // published zero removed assertions before the head was carried across the break.
        const facts = changedLineFacts({
            added: [],
            removed: [
                { line: 1349, text: '            expect' },
                { line: 1350, text: '                .soft(result.actions)' },
                { line: 1351, text: "                .toEqual([{ type: 'glueClips' }]);" },
            ],
        });
        expect(facts).toEqual({
            basis: 'unified-diff',
            before: { removedAssertions: { count: 2, lines: [1349, 1350], truncated: false } },
            after: {
                addedAssertions: { count: 0, lines: [], truncated: false },
                addedControlFlow: { count: 0, lines: [], truncated: false },
            },
        });
    });

    it('should not read a split matcher value as an assertion, and should not pair lines that are not adjacent', () => {
        const value = changedLineFacts({
            added: [],
            removed: [
                { line: 10, text: '        const sample = expect' },
                { line: 11, text: '            .objectContaining({ gain: 0.5 });' },
            ],
        });
        if (value.basis !== 'unified-diff') {
            throw new Error('the fixture must derive its block from the diff');
        }
        expect(value.before.removedAssertions).toEqual({ count: 0, lines: [], truncated: false });
        // A head at the end of one hunk's lines and an unrelated continuation at the start of the next are
        // not one assertion: only the next line in the file completes an open head.
        const acrossHunks = changedLineFacts({
            added: [],
            removed: [
                { line: 40, text: '        await expect' },
                { line: 90, text: '                .soft(result.rejections)' },
            ],
        });
        if (acrossHunks.basis !== 'unified-diff') {
            throw new Error('the fixture must derive its block from the diff');
        }
        expect(acrossHunks.before.removedAssertions).toEqual({ count: 0, lines: [], truncated: false });
    });

    it('should treat every asymmetric matcher each installed framework declares as a non-assertion', () => {
        // The non-assertion list is not allowed to be a hand-picked one: this derives each framework's
        // shipped asymmetric-matcher surface from its own declarations and fails when a member is missing.
        // `toSatisfy` and `toBeOneOf` (vitest) and `arrayOf` (playwright) are matcher values
        // (`expect(x).toEqual(expect.toBeOneOf(['a']))`), and a removed one would otherwise publish as a
        // removed assertion.
        const surfaces = installedMatcherSurfaces();
        expect(surfaces.vitest).toEqual(expect.arrayContaining(['objectContaining', 'toSatisfy', 'toBeOneOf']));
        expect(surfaces.playwright).toEqual(expect.arrayContaining(['objectContaining', 'arrayOf', 'closeTo']));
        const missing = Object.fromEntries(
            Object.entries(surfaces)
                .map(([framework, members]) => [
                    framework,
                    members.filter((member) => !NON_ASSERTION_EXPECT_MEMBERS.has(member)),
                ])
                .filter(([, members]) => (members as string[]).length > 0)
        );
        expect(missing).toEqual({});
    });

    it('should treat every expect helper the installed frameworks declare as a non-assertion, and hold nothing else', () => {
        // The matcher case above covers the value half of the list. This one covers the helper half, which
        // no declaration can classify: vitest's `ExpectStatic` declares `assertions` and `addEqualityTesters`
        // with the same `void` return, so which names are checks is pinned in EXPECT_HELPER_MEMBERS and the
        // installed declarations are what keep that pin honest.
        const declared = new Set(Object.values(installedExpectSurfaces()).flat());
        expect(EXPECT_HELPER_MEMBERS.filter((member) => !declared.has(member))).toEqual([]);
        // The pin itself: each helper's own head is not an assertion call. Deleting one from
        // NON_ASSERTION_EXPECT_MEMBERS fails here, which the two cases above cannot see.
        expect(EXPECT_HELPER_MEMBERS.filter((member) => isAssertionLine(`expect.${member}(value);`))).toEqual([]);
        // And the whole list is the derived matcher values plus those helpers, so a member added or
        // deleted without a declaration behind it fails in both directions rather than leaving a head
        // classified differently from what the installed frameworks ship.
        const matchers = new Set(Object.values(installedMatcherSurfaces()).flat());
        expect([...NON_ASSERTION_EXPECT_MEMBERS].sort()).toEqual(
            [...new Set([...matchers, ...EXPECT_HELPER_MEMBERS])].sort()
        );
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
