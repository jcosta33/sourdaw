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
import { dirname, join, sep } from 'node:path';

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
 *
 * The declared surface of one interface is what the installed package ships *plus* what this repository's
 * own declarations add to it: the program augments `AsymmetricMatchersContaining` with jest-dom's matchers,
 * and a derivation that read only the installed package would leave every one of them looking like a
 * runtime registration.
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

/** The repository root, resolved from this file so the guard reads the program wherever it is run from. */
const REPOSITORY_ROOT = dirname(createRequire(import.meta.url).resolve('../../../package.json'));

/**
 * The repository's own ambient declarations, where the program augments the framework interfaces:
 * `src/types/jest-dom-vitest.d.ts` declares `interface AsymmetricMatchersContaining extends
 * TestingLibraryMatchers<unknown, unknown>` inside `declare module 'vitest'`.
 */
const REPOSITORY_DECLARATIONS = declarationTextsAt(join(REPOSITORY_ROOT, 'src', 'types'));

/** Every declaration file under one directory, recursively. */
function declarationTextsAt(directory: string): string[] {
    const texts: string[] = [];
    const walk = (path: string): void => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, entry.name);
            if (entry.isDirectory()) {
                walk(child);
                continue;
            }
            if (entry.name.endsWith('.d.ts')) {
                texts.push(readFileSync(child, 'utf8'));
            }
        }
    };
    walk(directory);
    return texts;
}

/** Every declaration file one installed framework ships under the given directories. */
function declarationTexts(packageName: string, directories: readonly string[]): string[] {
    const packageFile = createRequire(import.meta.url).resolve(`${packageName}/package.json`);
    return directories.flatMap((directory) => declarationTextsAt(join(dirname(packageFile), directory)));
}

/** The package root one resolved module path belongs to: the path up to its own `node_modules` entry. */
function packageRootOf(resolvedPath: string): string | undefined {
    const marker = `${sep}node_modules${sep}`;
    const at = resolvedPath.lastIndexOf(marker);
    if (at === -1) {
        return undefined;
    }
    const root = resolvedPath.slice(0, at + marker.length);
    const [first, second] = resolvedPath.slice(at + marker.length).split(sep);
    const name = first?.startsWith('@') === true ? `${String(first)}/${String(second)}` : first;
    return name === undefined ? undefined : join(root, name);
}

/**
 * The declarations of the packages the repository's own files import from.
 *
 * Why they are needed. An augmentation adds names by extending an interface of its own — the repository's
 * extends `TestingLibraryMatchers`, whose members are jest-dom's fifty matchers — so the added names are
 * declared in the imported package rather than in the augmenting file. The specifier is read from the file
 * instead of naming the package here, so an augmentation that imports from anywhere is followed, and one
 * whose base still cannot be found fails the case below rather than contributing nothing.
 */
function importedDeclarationTexts(declarations: readonly string[]): string[] {
    const texts: string[] = [];
    const roots = new Set<string>();
    for (const declaration of declarations) {
        for (const match of declaration.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
            const specifier = match[1];
            if (specifier === undefined || specifier.startsWith('.')) {
                continue;
            }
            let resolved: string | undefined;
            try {
                resolved = createRequire(import.meta.url).resolve(specifier);
            } catch {
                resolved = undefined;
            }
            const root = resolved === undefined ? undefined : packageRootOf(resolved);
            if (root === undefined || roots.has(root)) {
                continue;
            }
            roots.add(root);
            texts.push(...declarationTextsAt(root));
        }
    }
    return texts;
}

/** The repository's declarations together with the packages they import their extended interfaces from. */
const AUGMENTATION_DECLARATIONS = [...REPOSITORY_DECLARATIONS, ...importedDeclarationTexts(REPOSITORY_DECLARATIONS)];

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

/**
 * Every declaration of one interface in one text: the header through its `{`, and the body. A name is
 * matched only when the character after it starts a generic argument, an extends clause, or a body, so
 * `interface CustomMatcher` is not read out of a longer name.
 */
function findInterfaceDeclarations(
    declaration: string,
    name: string
): { readonly header: string; readonly body: string }[] {
    const found: { header: string; body: string }[] = [];
    const pattern = new RegExp(`\\binterface\\s+${name}(?![A-Za-z0-9_$])`, 'gu');
    for (const match of declaration.matchAll(pattern)) {
        const start = match.index;
        const open = declaration.indexOf('{', start);
        if (open === -1) {
            continue;
        }
        const body = declarationBody(declaration, open);
        if (body !== undefined) {
            found.push({ header: declaration.slice(start, open), body });
        }
    }
    return found;
}

/** The members one declared interface contributes, in every file that declares it. */
function declaredInterfaceMembers(declarations: readonly string[], name: string): string[] {
    const members = new Set<string>();
    for (const declaration of declarations) {
        for (const found of findInterfaceDeclarations(declaration, name)) {
            for (const member of declaredMembers(found.body)) {
                members.add(member);
            }
        }
    }
    return [...members];
}

/**
 * The interface names one declaration header extends, with each base's generic arguments removed. The
 * commas inside a generic argument (`Matchers<any, void>`) separate arguments rather than bases, so the
 * split tracks angle brackets.
 */
function extendedInterfaceNames(header: string): string[] {
    const at = header.indexOf(' extends ');
    if (at === -1) {
        return [];
    }
    const names: string[] = [];
    let current = '';
    let angleDepth = 0;
    for (const character of header.slice(at + ' extends '.length)) {
        if (character === '<') {
            angleDepth += 1;
        } else if (character === '>') {
            angleDepth -= 1;
        }
        if (character === ',' && angleDepth === 0) {
            names.push(current);
            current = '';
            continue;
        }
        current += character;
    }
    names.push(current);
    return names.map((base) => base.split('<')[0]?.trim() ?? '').filter((base) => base !== '');
}

/**
 * The members this repository's own declarations add to one framework interface.
 *
 * A program augments an interface by extending one of its own — `src/types/jest-dom-vitest.d.ts` declares
 * `interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown>` — so the added
 * names belong to the extended interface and the augmenting body is empty. The base is resolved by name
 * across the repository's declarations and the packages they import, and followed through further
 * declarations of the same set; a base that resolves nowhere contributes nothing here and is named by the
 * case below, so an augmentation cannot add names the derived surface never sees.
 */
function augmentedInterfaceMembers(name: string): string[] {
    const members = new Set<string>();
    const visited = new Set<string>();
    const visit = (interfaceName: string): void => {
        if (visited.has(interfaceName)) {
            return;
        }
        visited.add(interfaceName);
        for (const declaration of AUGMENTATION_DECLARATIONS) {
            for (const found of findInterfaceDeclarations(declaration, interfaceName)) {
                for (const member of declaredMembers(found.body)) {
                    members.add(member);
                }
                for (const base of extendedInterfaceNames(found.header)) {
                    visit(base);
                }
            }
        }
    };
    visit(name);
    return [...members];
}

/** The extended interfaces the repository's declarations name and no declaration the guard reads carries. */
function unresolvedAugmentationBases(): string[] {
    const unresolved = new Set<string>();
    for (const declaration of REPOSITORY_DECLARATIONS) {
        for (const match of declaration.matchAll(/\binterface\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
            const name = match[1];
            if (name === undefined) {
                continue;
            }
            for (const found of findInterfaceDeclarations(declaration, name)) {
                for (const base of extendedInterfaceNames(found.header)) {
                    const declared = AUGMENTATION_DECLARATIONS.some(
                        (text) => findInterfaceDeclarations(text, base).length > 0
                    );
                    if (!declared) {
                        unresolved.add(base);
                    }
                }
            }
        }
    }
    return [...unresolved];
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
                [
                    ...source.interfaces.flatMap((name) => declaredInterfaceMembers(declarations, name)),
                    // What the program itself adds to those interfaces counts as declared, or a name this
                    // repository augments the framework with would read as a runtime registration.
                    ...source.interfaces.flatMap((name) => augmentedInterfaceMembers(name)),
                ],
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

/**
 * The `expect.<member>(` heads an installed framework registers at run time through `expect.extend`, which
 * no declaration carries as an `expect` surface: vitest declares its bench pair on `Assertion` — the
 * chained `expect(result).toBeFasterThan(baseline)` form — and reaches them as values only because the
 * bench runner registers them, and a package that augments the framework from its own types, jest-dom's
 * matchers among them, is registered rather than declared too.
 *
 * The bound is the registration itself, read from the live framework in the case below: a name here must
 * be absent from every derived surface, present on the installed `expect`, and answer with an
 * asymmetric-matcher value. A declaration member placed here fails, which is what keeps this category from
 * hiding a check the equality would then admit.
 */
const EXPECT_REGISTERED_MATCHER_MEMBERS: readonly string[] = ['toBeFasterThan', 'toBeSlowerThan'];

/**
 * The argument the case below hands a registered matcher to read its shape. A registered matcher builds a
 * matcher value from its expectation without judging it — the comparison happens when the value is matched
 * — so any sample works, and this one is shaped like the benchmark result the bench pair expects.
 */
const REGISTERED_MATCHER_SAMPLE = { latency: { mean: 1 } };

/**
 * Whether one name reaches `expect.<member>(` as a matcher value because an installed framework registered
 * it through `expect.extend`, rather than because a declaration carries it: absent from every derived
 * surface, and a live member of the given `expect` object that answers with an asymmetric matcher.
 *
 * The parameter is the live object rather than the module's own `expect` so the rule can be exercised over
 * a stand-in for a package the case cannot register, and so the two directions — a name the declarations
 * carry is never registered, whatever the live object answers — are the rule rather than a convention.
 */
function isRegisteredMatcher(
    member: string,
    declared: ReadonlySet<string>,
    live: Readonly<Record<string, unknown>>
): boolean {
    if (declared.has(member)) {
        return false;
    }
    const registered = live[member];
    if (typeof registered !== 'function') {
        return false;
    }
    const produced = (registered as (input: unknown) => unknown)(REGISTERED_MATCHER_SAMPLE);
    return typeof (produced as { asymmetricMatch?: unknown }).asymmetricMatch === 'function';
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
            // Matchers vitest registers at run time, reached as values rather than as chained matchers: a
            // removed one is a removed matcher, not a removed assertion.
            'expect.toBeFasterThan(baseline),',
            'expect.toBeSlowerThan(baseline),',
            // A matcher this repository's own augmentation declares, reached the same way.
            "expect.toHaveValue('1/4'),",
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
        // And the whole list is the derived matcher values plus those helpers and the registered matchers,
        // so a member added or deleted without a declaration or a registration behind it fails in both
        // directions rather than leaving a head classified differently from what the installed frameworks
        // ship.
        const matchers = new Set(Object.values(installedMatcherSurfaces()).flat());
        expect([...NON_ASSERTION_EXPECT_MEMBERS].sort()).toEqual(
            [...new Set([...matchers, ...EXPECT_HELPER_MEMBERS, ...EXPECT_REGISTERED_MATCHER_MEMBERS])].sort()
        );
    });

    it('should treat every matcher the installed frameworks register at run time as a non-assertion', () => {
        // The registration route `expect.extend` opens after the declarations are written: a matcher it
        // adds is a value (`expect.toBeFasterThan(baseline)`), which is the shape that made a removed bench
        // matcher publish as a removed assertion. The bound is read from the live framework, not assumed.
        const declared = new Set([
            ...Object.values(installedMatcherSurfaces()).flat(),
            ...Object.values(installedExpectSurfaces()).flat(),
        ]);
        const live = expect as unknown as Record<string, unknown>;
        for (const member of EXPECT_REGISTERED_MATCHER_MEMBERS) {
            expect(isRegisteredMatcher(member, declared, live)).toBe(true);
            // The pin itself: the head a removed line spells is not an assertion call.
            expect(isAssertionLine(`expect.${member}(baseline),`)).toBe(false);
        }
    });

    it('should read the matchers this repository augments the frameworks with, and refuse them as registrations', () => {
        // The program's own augmentation is part of the declared surface:
        // `src/types/jest-dom-vitest.d.ts` extends vitest's `AsymmetricMatchersContaining` with jest-dom's
        // set, so each of those names is declared and none can pass the registration rule, which admits
        // only a name no declaration carries. A derivation reading the installed package alone would admit
        // them and would count a removed `expect.toHaveValue('1/4'),` as a removed assertion.
        const declared = new Set([
            ...Object.values(installedMatcherSurfaces()).flat(),
            ...Object.values(installedExpectSurfaces()).flat(),
        ]);
        expect(declared.has('toHaveValue')).toBe(true);
        expect(declared.has('toBeInTheDocument')).toBe(true);
        const live = expect as unknown as Record<string, unknown>;
        expect(isRegisteredMatcher('toHaveValue', declared, live)).toBe(false);
        expect(isAssertionLine("expect.toHaveValue('1/4'),")).toBe(false);
        // An augmentation whose extended interface the guard cannot find is a hole in the surface, so it is
        // named here rather than silently contributing nothing.
        expect(unresolvedAugmentationBases()).toEqual([]);
    });

    it('should admit a name through the registration route rather than through the pair it pins', () => {
        // The route in general, exercised over a stand-in for a registration the declarations cannot carry
        // — a project-local `expect.extend`, or an augmentation of a package the guard cannot read — so the
        // category is the registration and not a list of the names that happened to need it. A name the
        // declarations carry is refused whatever the live object answers, and a live name that answers with
        // something other than a matcher value is no registration at all.
        const declared = new Set([
            ...Object.values(installedMatcherSurfaces()).flat(),
            ...Object.values(installedExpectSurfaces()).flat(),
        ]);
        const augmented: Readonly<Record<string, unknown>> = {
            someProjectMatcher: () => ({ asymmetricMatch: () => true }),
            toBeFasterThan: () => ({ asymmetricMatch: () => true }),
            // A declared matcher value, a declared helper, and a name this repository's own augmentation
            // declares, all matcher-shaped here so the refusal is the declaration and not the shape, plus a
            // live function that is not a matcher value at all.
            objectContaining: () => ({ asymmetricMatch: () => true }),
            configure: () => ({ asymmetricMatch: () => true }),
            toBeInTheDocument: () => ({ asymmetricMatch: () => true }),
            plainFunction: () => ({}),
        };
        expect(isRegisteredMatcher('someProjectMatcher', declared, augmented)).toBe(true);
        expect(isRegisteredMatcher('toBeFasterThan', declared, augmented)).toBe(true);
        expect(isRegisteredMatcher('objectContaining', declared, augmented)).toBe(false);
        expect(isRegisteredMatcher('configure', declared, augmented)).toBe(false);
        expect(isRegisteredMatcher('toBeInTheDocument', declared, augmented)).toBe(false);
        expect(isRegisteredMatcher('plainFunction', declared, augmented)).toBe(false);
        expect(isRegisteredMatcher('toBeFasterThan', declared, {})).toBe(false);
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
