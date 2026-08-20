#!/usr/bin/env node
/**
 * `pnpm check:barrel-mocks` — proves that no spec mocks a contract barrel while
 * omitting an export that spec's own module graph imports from it.
 *
 * Why this exists. A `vi.mock` of a contract barrel whose factory lists every
 * export by hand — no `...(await importOriginal())` — resolves any export added
 * to that barrel *later* to `undefined`. When the consumer renders it, every test
 * in the mocking spec file throws. #1392 is the worked example: `MissingMediaPanel`
 * was added to `Project/presentations/views` and mounted in `TransportBar`, and the
 * red landed in `TransportBar.spec.tsx` — a WorkspaceShell failure for a diff that
 * only touched Project. Focused specs on the changed files stay green, so nothing
 * short of the full suite catches it, and the full suite is exactly what an author
 * mid-change does not run.
 *
 * What it checks. For every `vi.mock('<contract barrel>', factory)` whose factory
 * does not spread `importOriginal`, the mocked keys must cover every name the
 * spec's transitive module graph imports from that barrel. Modules the spec also
 * mocks are not traversed — their real imports never happen. A spread factory is
 * additive by construction and is not checked.
 *
 * This is the static twin of what vitest raises at runtime ("No X export is defined
 * on the ... mock"), moved to the moment the export is added rather than the moment
 * some unrelated spec renders it, and it names both sides: the barrel that grew and
 * the spec that did not follow.
 *
 * How it can fail (ADR 0015).
 *
 *  1. **Mutation.** Delete any key from an exhaustive barrel-mock factory whose
 *     name the consumer imports — e.g. `MissingMediaPanel` in
 *     `WorkspaceShell/presentations/views/__tests__/TransportBar.spec.tsx` — and
 *     this reports it. Equivalently: add an export to a barrel, use it in a
 *     consumer, and every exhaustive mock of that barrel in that consumer's specs
 *     is reported.
 *  2. **Population from a registry, not a list.** The population is every `vi.mock`
 *     call parsed out of every spec under `src/`, and the required names come from
 *     the real import statements. Neither side is hand-maintained here, so a spec
 *     added tomorrow is covered without editing this file.
 *  3. **Planted broken fixtures.** `scripts/__tests__/checkBarrelMockCoverage.spec.ts`
 *     runs the analyzer against in-memory graphs that are deliberately wrong, so the
 *     "no violations" verdict is never reached by an extraction that has gone blind.
 *  4. **It cannot pass by deriving nothing.** Every way of producing an empty
 *     analysis — a resolver that resolves nothing, a reader that returns nothing, a
 *     parser whose tree is truncated, a glob that matches nothing — reports zero
 *     violations, and zero violations is what "clean" looks like. `checkDerivation`
 *     below fails the run when the counts behind the verdict are at the floor, and
 *     the OK line prints what was analysed rather than what was globbed.
 *
 * Exit code 0 = every exhaustive contract-barrel mock covers what its graph uses,
 * 1 = at least one does not, or the analysis derived too little to say.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'src');

/**
 * The four contract-folder barrels (ADR 0006). A module's public surface is only
 * ever one of these, so this list is the population definition, not a sample.
 * `Common/` and `Supporting/` are the namespaced module groups.
 */
export const allBarrelKinds = ['useCases', 'stores', 'events', 'presentations/views'] as const;

/**
 * What the gate fails on, and why the line is here rather than around all four.
 *
 * Not because the other three fail differently. Simulated on a `useCases` barrel,
 * vitest 4 raises the same named error it raises for a view — `No "…" export is
 * defined on the "…" mock` — and a call at module scope takes the whole file just
 * as a render does. The difference is blast radius, and even that is incidental.
 *
 * `presentations/views` and `events` are at zero. `stores` joined them despite
 * carrying its own pre-existing debt (#2364: `#/modules/Arrangement/stores` grew
 * `persistDeviceParam`, and three specs' hand-listed mocks omitted it — one of
 * them, collected as part of `main` and not some unrelated suite, failed to
 * collect at all, the same blast-radius failure `presentations/views` was gated
 * to catch). Widening the scan surfaced more than those three, because `stores`
 * fans out into use-case registries (AI action descriptions, command handlers,
 * offline render, MIDI, Knead) that statically import far more of the barrel
 * than any one spec's tests actually read, so the graph walk — which cannot tell
 * "imported" from "imported and later executed" apart without running the code —
 * over-reports. The specs whose own bug this gate exists to catch are fixed for
 * real (every missing key stubbed, not spread — spreading a barrel this size
 * measurably slows the specs that already avoid it, see `formatViolation`'s
 * App.spec.tsx numbers). The over-reported remainder are `exemptions` rows: each
 * one is evidenced by a passing `pnpm test:run` on the unmodified spec, not
 * assumed, and is documented as debt to close later rather than debt hidden by
 * narrowing the gate.
 *
 * `useCases` is not gated at all. Gating it now would need a baseline row per
 * outstanding pair whose only content is "pre-existing", which is a baseline
 * wearing an exemption table's clothes — a handful of reasoned, evidenced rows
 * is a table; a hundred unexamined ones is not. `--all` keeps that debt
 * measurable, in the unit a person repairs (the (spec, barrel) pair, counted
 * once however many consuming modules import through it), so a follow-up
 * clearing it to zero starts from a real measurement rather than a number
 * someone wrote down.
 *
 * `presentations/views` is at zero violations because every exhaustive mock of
 * that kind already lists every export its graph consumes. `events` is at zero
 * for a different reason worth naming plainly rather than folding into the same
 * sentence: no spec mocks an `events` contract barrel at all today, so this is a
 * pre-commitment, not a measured clean bill — the first `events` mock the tree
 * gets is caught by this gate the moment it goes stale, rather than needing a
 * later change to start checking it. The guard spec asserts that population is
 * zero for exactly this kind, so the day it stops being zero someone rereads
 * this paragraph instead of the assertion silently passing on an empty set.
 *
 * Exported so the guard spec makes its "no violations" claim once per gated kind
 * and cannot silently stop claiming one.
 */
export const gatedBarrelKinds: ReadonlyArray<(typeof allBarrelKinds)[number]> = [
    'presentations/views',
    'stores',
    'events',
];

function buildBarrelPattern(kinds: ReadonlyArray<string>): RegExp {
    const kindAlternation = kinds.map((kind) => kind.replace('/', '\\/')).join('|');
    return new RegExp(
        `^#\\/modules\\/[A-Za-z0-9]+(?:\\/(?:Common|Supporting)\\/[A-Za-z0-9]+)?\\/(?:${kindAlternation})$`
    );
}

const moduleExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * One row of the `exemptions` table. `missingKeys` is the exact, closed set of
 * export names this row mutes for this (spec, barrel) pair — not the pair itself.
 * A name the graph later starts requiring that is not in this list is not covered
 * by the row and still violates, and `reason` documents why the listed names are
 * safe to mute today; it is prose, not something the checker reads to decide
 * scope.
 */
export type ExemptionRow = {
    spec: string;
    barrel: string;
    missingKeys: string[];
    reason: string;
};

/**
 * Exemptions. Each row must carry the spec, the barrel, the exact key names it
 * mutes, and the reason those keys are deliberately unread by the graph. Empty is
 * the correct state; a row here is debt with a name on it, not a silenced check.
 *
 * A row mutes only `missingKeys` — any other name the graph later starts
 * requiring from that (spec, barrel) pair still violates. This is what keeps the
 * table from becoming a permanent blind spot on the pair: it does not need to be
 * touched again unless the *named* keys stop being the problem, and a name
 * outside the list is caught the moment it matters. `checkDerivation`'s sibling,
 * `staleExemptions` below, also holds the table itself honest: a row whose listed
 * keys the graph walk no longer finds missing is reported rather than left to
 * quietly outlive the debt it was written for.
 *
 * This is a documented exit, not evasion, and the failure output and
 * `docs/06-testing.md` §5 both name it — a knob nobody can find from the error is
 * the same as no knob, and `AGENTS.md` rightly tells people that editing a checker
 * is cheating. Adding a row with a real reason is not that; deleting the check, or
 * adding a row because the gate was inconvenient, is.
 */
const exemptions: ReadonlyArray<ExemptionRow> = [
    // Pre-existing `stores` debt, surfaced (not caused) by gating `stores` in this
    // change — the same shape as the three specs fixed alongside this gate
    // (persistDeviceParam), but the fix for these eight was out of scope for that
    // patch. Each row is evidenced, not assumed: `pnpm test:run <spec>` passes
    // today, proving every listed name is read only inside a function body none of
    // that spec's tests ever call — the graph walk treats reachable-via-import as
    // required, with no way to tell that apart from reachable-and-executed short
    // of running the code. Follow-up: replace each row with a real fix (stub the
    // missing keys, same as the three specs above) rather than carrying it here
    // indefinitely.
    {
        spec: 'src/modules/Arrangement/presentations/hooks/__tests__/useTimelineInteractions.spec.tsx',
        barrel: '#/modules/MIDI/stores',
        missingKeys: [
            'GROOVE_CONSUMER_TYPES',
            'LEGACY_MIDI_PROBABILITY_SEED',
            'canonicalizeGrooveConsumerId',
            'chordTrackStore',
            'defaultChordTrackState',
            'defaultGrooveTemplateState',
            'grooveTemplateProjectRevisionStore',
            'grooveTemplateStore',
            'isChordTrackState',
            'isGrooveTemplateState',
            'sanitizeGrooveTemplateState',
        ],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/CommandInterface/useCases/commands/__tests__/RenameCommands.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: ['clipSelectionStore'],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/CommandInterface/useCases/keyboardShortcutActions/__tests__/handleKeyboardShortcut.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: ['markerStore', 'resolveEligibleDeviceWriteTarget'],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/Crust/useCases/crustParamBridge/__tests__/loadCrustPatchWithAudio.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: [
            'appendClipToTrack',
            'clipSelectionStore',
            'gainEnvelopeStore',
            'getTrackEligibility',
            'markerStore',
            'resolveEligibleClipWriteTarget',
            'takeLaneStore',
            'updateClipInStore',
            'vcaGroupStore',
        ],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/MIDI/useCases/webMidiInput/__tests__/initWebMidi.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: [
            'addWarpMarker',
            'adjustmentLayerStore',
            'clampDeviceParamWrite',
            'deriveEffectiveAudibility',
            'deriveVcaMultiplier',
            'getVcaGroupsState',
            'getWarpState',
            'shouldCreateLiveTrackStrip',
            'takeLaneStore',
            'warpStates',
        ],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/TimelineEditor/presentations/views/ClipView/__tests__/AutomationLane.spec.tsx',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: [
            'addWarpMarker',
            'adjustmentLayerStore',
            'clampDeviceParamWrite',
            'deriveEffectiveAudibility',
            'deriveVcaMultiplier',
            'getVcaGroupsState',
            'getWarpState',
            'shouldCreateLiveTrackStrip',
            'takeLaneStore',
            'warpStates',
        ],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/Transport/useCases/__tests__/ensureTrackStrips.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: [
            'appendClipToTrack',
            'clipSelectionStore',
            'gainEnvelopeStore',
            'resolveEligibleClipWriteTarget',
            'updateClipInStore',
            'vcaGroupStore',
        ],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
    {
        spec: 'src/modules/Transport/useCases/playheadScheduler/__tests__/startPlayheadSchedulerSeamNotes.spec.ts',
        barrel: '#/modules/Arrangement/stores',
        missingKeys: ['appendClipToTrack', 'clipSelectionStore', 'resolveEligibleClipWriteTarget', 'updateClipInStore'],
        reason: "Reachable via this spec's graph but never read by its tests (verified passing).",
    },
];

export type MockedBarrel = {
    /** Module specifier passed to `vi.mock` / `vi.doMock`. */
    specifier: string;
    /** 1-based line of the mock call, for the report. */
    line: number;
    /** Top-level keys of the object literal the factory returns. */
    keys: string[];
    /**
     * True when the returned object literal spreads a value derived from the
     * factory's own `importOriginal` parameter. A parameter merely *named*
     * `importOriginal`, or the word in a comment, is not a spread: the missed case
     * is `async (importOriginal) => ({ Alpha, Beta })`, which is the corrected
     * signature minus the one line that does the work.
     */
    spreadsOriginal: boolean;
};

export type FileFacts = {
    /** Resolved-path → names imported from it (`*` means a namespace import). */
    imports: Map<string, Set<string>>;
    /** `vi.mock` / `vi.doMock` calls found in this file (empty for non-spec modules). */
    mocks: MockedBarrel[];
    /**
     * Mock calls the scanner saw, and mock calls the parser produced — including
     * the argument-less `vi.mock('./x')` form, which carries no factory and so
     * never reaches `mocks`. `ts.createSourceFile` never throws: a syntactically
     * broken file yields a partial tree and therefore zero mocks, which reads
     * identically to "this file has none". Two independently-sourced counts are
     * what tells those apart (ADR 0015 rule 3).
     */
    scannedMockCalls: number;
    parsedMockCalls: number;
};

export type Violation = {
    spec: string;
    line: number;
    barrel: string;
    missing: string[];
    /** The module in the graph whose import would resolve to `undefined`. */
    usedBy: string;
};

/**
 * An `exemptions` row that no longer matches the debt it names. Either its
 * (spec, barrel) pair was never placed under test this run (the mock is gone, or
 * spreads now, or the barrel kind is out of scope for this scan), or the graph
 * walk never found one or more of its `missingKeys` actually missing — the row is
 * muting a name that stopped needing it. Both are the same failure mode `main`
 * treats as a debt table drifting away from the debt it was written to describe.
 */
export type StaleExemption = {
    spec: string;
    barrel: string;
    /**
     * Empty means the pair itself never matched this run (delete the row).
     * Non-empty names the subset of `missingKeys` the graph walk never needed
     * (narrow the row to what is still real, or delete it if that empties it).
     */
    unusedKeys: string[];
};

/**
 * The verdict plus the derivation counts behind it. A check of this shape fails
 * open in every direction that produces an empty analysis — a resolver that
 * resolves nothing, a reader that returns nothing, a parser that parses nothing,
 * a glob that matches nothing — and "no violations" looks identical in all four.
 * These counts are what `main` and the guard spec assert a floor on.
 */
export type AnalysisResult = {
    violations: Violation[];
    /** Specs whose raw text contains a mock call the parser did not produce. */
    extractionFailures: string[];
    /** Mock calls the parser produced. */
    parsedMockCount: number;
    /** Mock calls whose specifier resolved to a file on disk. */
    resolvedMockCount: number;
    /** Specs that reached the graph walk (had at least one gated non-spread mock). */
    analyzedSpecCount: number;
    /** Total module-graph nodes walked, summed over analysed specs. */
    graphNodeCount: number;
    /**
     * `exemptions` rows evaluated against this scan that no longer match live
     * debt. Empty is the only state that lets the exemption table be trusted at
     * face value; see `ExemptionRow` and `StaleExemption`.
     */
    staleExemptions: StaleExemption[];
    /**
     * Number of (spec, barrel) pairs placed under test this scan, per barrel
     * kind — the population each per-kind claim is actually made against, not
     * just its violation count. A kind with zero pairs here has an empty claim:
     * "no violations" is true because nothing was checked, not because
     * something was checked and found clean.
     */
    matchedBarrelKindCounts: Record<string, number>;
};

/**
 * Reads and parses one file into the facts the analysis needs. Injected so the
 * spec can plant in-memory graphs, including broken ones.
 */
export type ReadFacts = (absolutePath: string) => FileFacts | null;

function unwrapParenthesized(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

/**
 * Locates the object literal the factory actually *returns* — not the first object
 * literal anywhere in its body. A factory that builds local state before returning,
 * e.g. `const trackStore = { value: … }; return { ...mod, trackStore };`, has an
 * object literal in that local well before the `return`; a walk that stops at the
 * first match reads the local's keys (`value`) instead of the real ones, and misses
 * a real `...mod` spread entirely — `applyAutomation.spec.ts` false-flagged this way
 * despite already spreading `importOriginal`. Nested functions (getters, a
 * `vi.fn(() => …)` callback) are not descended into: their return value is not this
 * factory's.
 */
function findReturnedObjectLiteral(factory: ts.Node): ts.ObjectLiteralExpression | null {
    if (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) {
        if (!ts.isBlock(factory.body)) {
            const expression = unwrapParenthesized(factory.body);
            return ts.isObjectLiteralExpression(expression) ? expression : null;
        }
        let found: ts.ObjectLiteralExpression | null = null;
        const walk = (node: ts.Node): void => {
            if (found !== null) {
                return;
            }
            if (ts.isFunctionLike(node) && node !== factory) {
                return;
            }
            if (ts.isReturnStatement(node) && node.expression) {
                const expression = unwrapParenthesized(node.expression);
                if (ts.isObjectLiteralExpression(expression)) {
                    found = expression;
                }
                return;
            }
            node.forEachChild(walk);
        };
        walk(factory.body);
        return found;
    }

    // Fallback for a non-function factory argument — kept permissive, matching
    // this parser's previous behaviour for a shape it has not seen in practice.
    let found: ts.ObjectLiteralExpression | null = null;
    const walk = (node: ts.Node): void => {
        if (found !== null) {
            return;
        }
        if (ts.isObjectLiteralExpression(node)) {
            found = node;
            return;
        }
        node.forEachChild(walk);
    };
    walk(factory);
    return found;
}

function parseObjectKeys(factory: ts.Node): string[] {
    const objectLiteral = findReturnedObjectLiteral(factory);
    if (!objectLiteral) {
        return [];
    }
    return objectLiteral.properties
        .map((property) => {
            if (!property.name) {
                return null;
            }
            if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
                return property.name.text;
            }
            return null;
        })
        .filter((name): name is string => name !== null);
}

function collectIdentifiers(node: ts.Node, into: Set<string>): void {
    if (ts.isIdentifier(node)) {
        into.add(node.text);
    }
    node.forEachChild((child) => {
        collectIdentifiers(child, into);
    });
}

/** `vi.importActual(specifier)`, awaited or not — the parameter-less twin of a
 * factory's own `importOriginal` argument, and an equally common way to reach the
 * real module. */
function isImportActualCall(node: ts.Node): boolean {
    const expression = ts.isAwaitExpression(node) ? node.expression : node;
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
        return false;
    }
    return (
        ts.isIdentifier(expression.expression.expression) &&
        expression.expression.expression.text === 'vi' &&
        expression.expression.name.text === 'importActual'
    );
}

function containsImportActualCall(node: ts.Node): boolean {
    if (isImportActualCall(node)) {
        return true;
    }
    let found = false;
    node.forEachChild((child) => {
        if (!found) {
            found = containsImportActualCall(child);
        }
    });
    return found;
}

/**
 * True when the factory's returned object literal spreads a value that traces back
 * to the real module — the factory's first parameter (`...(await importOriginal())`
 * directly, or `const actual = await importOriginal(); return { ...actual, … }`
 * through a local), or a `vi.importActual(specifier)` call (inline in the spread,
 * or through a local the same way). Textual detection was wrong:
 * `factoryText.includes('importOriginal')` accepts a parameter that is declared and
 * never used, and accepts the word in a comment.
 */
function detectOriginalSpread(factory: ts.Node): boolean {
    if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) {
        return false;
    }

    const objectLiteral = findReturnedObjectLiteral(factory);
    if (!objectLiteral) {
        return false;
    }

    // Names that carry the original module: the `importOriginal` parameter, if the
    // factory has one, plus locals initialised from anything already in the set.
    // Two passes settle the chains that occur in practice (`const actual = await
    // importOriginal()` and one alias of it).
    const parameter = factory.parameters[0];
    const originNames = new Set<string>();
    if (parameter && ts.isIdentifier(parameter.name)) {
        originNames.add(parameter.name.text);
    }
    for (let pass = 0; pass < 2; pass += 1) {
        const collectAliases = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
                if (containsImportActualCall(node.initializer)) {
                    originNames.add(node.name.text);
                } else {
                    const referenced = new Set<string>();
                    collectIdentifiers(node.initializer, referenced);
                    for (const name of referenced) {
                        if (originNames.has(name)) {
                            originNames.add(node.name.text);
                            break;
                        }
                    }
                }
            }
            node.forEachChild(collectAliases);
        };
        collectAliases(factory);
    }

    return objectLiteral.properties.some((property) => {
        if (!ts.isSpreadAssignment(property)) {
            return false;
        }
        if (containsImportActualCall(property.expression)) {
            return true;
        }
        const referenced = new Set<string>();
        collectIdentifiers(property.expression, referenced);
        return [...referenced].some((name) => originNames.has(name));
    });
}

/**
 * Counts `vi.mock(` / `vi.doMock(` with the *scanner* rather than the parser.
 * Tokenising is a separate stage from parsing: a file whose syntax is broken still
 * scans, so this stays accurate exactly where the parser silently returns a partial
 * tree. It is also immune to the word appearing in a comment or a string, which a
 * regex over the raw text is not — both are single tokens the state machine skips.
 */
function countScannedMockCalls(contents: string): number {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, ts.LanguageVariant.JSX, contents);
    let count = 0;
    let stage = 0;
    let token = scanner.scan();
    while (token !== ts.SyntaxKind.EndOfFileToken) {
        if (stage === 0 && token === ts.SyntaxKind.Identifier && scanner.getTokenText() === 'vi') {
            stage = 1;
        } else if (stage === 1 && token === ts.SyntaxKind.DotToken) {
            stage = 2;
        } else if (
            stage === 2 &&
            token === ts.SyntaxKind.Identifier &&
            (scanner.getTokenText() === 'mock' || scanner.getTokenText() === 'doMock')
        ) {
            stage = 3;
        } else if (stage === 3 && token === ts.SyntaxKind.OpenParenToken) {
            count += 1;
            stage = 0;
        } else {
            stage = token === ts.SyntaxKind.Identifier && scanner.getTokenText() === 'vi' ? 1 : 0;
        }
        token = scanner.scan();
    }
    return count;
}

/** `vi.mock(…)` and `vi.doMock(…)` — both replace the module for the graph. */
function isMockCall(call: ts.CallExpression): boolean {
    if (!ts.isPropertyAccessExpression(call.expression)) {
        return false;
    }
    if (!ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== 'vi') {
        return false;
    }
    return call.expression.name.text === 'mock' || call.expression.name.text === 'doMock';
}

/**
 * The mocked specifier, from either accepted form: a string literal, or the
 * `vi.mock(import('…'), factory)` form — which is what vitest 4's own runtime error
 * tells the developer to write, so a gate that cannot read it is blind to the shape
 * the tool recommends.
 */
function readMockSpecifier(argument: ts.Expression): string | null {
    if (ts.isStringLiteralLike(argument)) {
        return argument.text;
    }
    const unwrapped = ts.isAwaitExpression(argument) ? argument.expression : argument;
    if (
        ts.isCallExpression(unwrapped) &&
        unwrapped.expression.kind === ts.SyntaxKind.ImportKeyword &&
        unwrapped.arguments[0] &&
        ts.isStringLiteralLike(unwrapped.arguments[0])
    ) {
        return unwrapped.arguments[0].text;
    }
    return null;
}

function collectThenCallbackProperties(call: ts.CallExpression, names: Set<string>): void {
    // `import('…').then((m) => ({ default: m.Foo }))` — the lazy-panel shape. The
    // dynamic import is still subject to the mock, so `m.Foo` is a required name.
    const parent = call.parent;
    if (!parent || !ts.isPropertyAccessExpression(parent) || parent.name.text !== 'then') {
        return;
    }
    const thenCall = parent.parent;
    if (!thenCall || !ts.isCallExpression(thenCall)) {
        return;
    }
    const callback = thenCall.arguments[0];
    if (!callback) {
        return;
    }
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
        return;
    }
    const parameter = callback.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name)) {
        return;
    }
    const parameterName = parameter.name.text;
    const walk = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === parameterName
        ) {
            names.add(node.name.text);
        }
        node.forEachChild(walk);
    };
    walk(callback.body);
}

/** Parses one source file. Exported so the analyzer and its spec share the parser. */
export function readFileFacts(absolutePath: string, contents: string): FileFacts {
    // Script kind must follow the extension. Parsing a `.ts` file as TSX makes
    // `<T>value` casts and generic arrows parse as JSX, and the tree is silently
    // truncated from there: `persistCrdtProject.spec.ts` yielded 3 of its 12 mock
    // calls until the scanner cross-check below disagreed with the parser.
    const scriptKind = absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(absolutePath, contents, ts.ScriptTarget.Latest, true, scriptKind);
    const imports = new Map<string, Set<string>>();
    const mocks: MockedBarrel[] = [];
    let parsedMockCalls = 0;

    const addImport = (specifier: string, names: Iterable<string>): void => {
        const existing = imports.get(specifier);
        if (existing) {
            for (const name of names) {
                existing.add(name);
            }
            return;
        }
        imports.set(specifier, new Set(names));
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            if (clause && !clause.isTypeOnly) {
                const names: string[] = [];
                if (clause.name) {
                    names.push('default');
                }
                if (clause.namedBindings) {
                    if (ts.isNamespaceImport(clause.namedBindings)) {
                        names.push('*');
                    } else {
                        for (const element of clause.namedBindings.elements) {
                            if (!element.isTypeOnly) {
                                names.push((element.propertyName ?? element.name).text);
                            }
                        }
                    }
                }
                addImport(node.moduleSpecifier.text, names);
            } else if (!clause) {
                addImport(node.moduleSpecifier.text, []);
            }
        }

        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.isTypeOnly) {
                if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    const names = node.exportClause.elements
                        .filter((element) => !element.isTypeOnly)
                        .map((element) => (element.propertyName ?? element.name).text);
                    addImport(node.moduleSpecifier.text, names);
                } else {
                    addImport(node.moduleSpecifier.text, ['*']);
                }
            }
        }

        if (ts.isCallExpression(node)) {
            const firstArgument = node.arguments[0];
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            if (isDynamicImport && firstArgument && ts.isStringLiteralLike(firstArgument)) {
                const names = new Set<string>();
                collectThenCallbackProperties(node, names);
                addImport(firstArgument.text, names);
            }

            if (isMockCall(node)) {
                parsedMockCalls += 1;
                const factory = node.arguments[1];
                const specifier = firstArgument ? readMockSpecifier(firstArgument) : null;
                if (factory && specifier !== null) {
                    mocks.push({
                        specifier,
                        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                        keys: parseObjectKeys(factory),
                        spreadsOriginal: detectOriginalSpread(factory),
                    });
                }
            }
        }

        node.forEachChild(visit);
    };

    visit(sourceFile);
    return { imports, mocks, scannedMockCalls: countScannedMockCalls(contents), parsedMockCalls };
}

/**
 * Resolves a module specifier the way `vite.config.ts` does: `#/…` is `src/…`,
 * relative paths are relative to the importer, everything else is a package and
 * is not part of the graph.
 */
export function resolveSpecifier(
    specifier: string,
    importerDirectory: string,
    fileExists: (path: string) => boolean
): string | null {
    let base: string;
    if (specifier.startsWith('#/')) {
        base = join(sourceRoot, specifier.slice(2));
    } else if (specifier.startsWith('.')) {
        base = resolve(importerDirectory, specifier);
    } else {
        return null;
    }

    if (fileExists(base)) {
        return base;
    }
    for (const extension of moduleExtensions) {
        if (fileExists(base + extension)) {
            return base + extension;
        }
    }
    for (const extension of moduleExtensions) {
        const indexPath = join(base, `index${extension}`);
        if (fileExists(indexPath)) {
            return indexPath;
        }
    }
    return null;
}

export type AnalyzeInput = {
    specPaths: string[];
    readFacts: ReadFacts;
    fileExists: (path: string) => boolean;
    /** Barrel kinds to check. Defaults to the gated set. */
    barrelKinds?: ReadonlyArray<string>;
    /**
     * Exemption rows to apply. Defaults to the real `exemptions` table. Injected
     * so a planted fixture can prove the mechanism itself — that a row mutes only
     * its named keys, not the pair — without depending on live repo debt, and so
     * a measurement run can disable exemptions entirely by passing `[]`.
     */
    exemptions?: ReadonlyArray<ExemptionRow>;
};

/** `#/modules/Foo/Common/Bar/presentations/views` → `presentations/views`. No kind
 * is a suffix of another, so the suffix test partitions unambiguously. */
function kindOfSpecifier(specifier: string): string | undefined {
    return allBarrelKinds.find((kind) => specifier.endsWith(`/${kind}`));
}

/**
 * Walks each spec's module graph and reports every exhaustive contract-barrel mock
 * that omits a name the graph imports from that barrel.
 */
export function analyzeSpecs({
    specPaths,
    readFacts,
    fileExists,
    barrelKinds,
    exemptions: exemptionRows = exemptions,
}: AnalyzeInput): AnalysisResult {
    const kinds = barrelKinds ?? gatedBarrelKinds;
    const contractBarrelPattern = buildBarrelPattern(kinds);
    const violations: Violation[] = [];
    const extractionFailures: string[] = [];
    let parsedMockCount = 0;
    let resolvedMockCount = 0;
    let analyzedSpecCount = 0;
    let graphNodeCount = 0;
    const matchedBarrelKindCounts: Record<string, number> = {};

    // Exemption bookkeeping. `matchedPair` records that a row's (spec, barrel)
    // pair was placed under test this run; `seenKeys` records which of the row's
    // `missingKeys` the graph walk actually found missing at least once. A row
    // in scope for this scan (its barrel kind is among `kinds`) that never
    // matches a pair, or whose `missingKeys` are not fully seen, is stale.
    const inScopeExemptions = exemptionRows.filter((row) => contractBarrelPattern.test(row.barrel));
    const matchedPair = new Set<ExemptionRow>();
    const seenKeys = new Map<ExemptionRow, Set<string>>();
    for (const row of inScopeExemptions) {
        seenKeys.set(row, new Set());
    }

    for (const specPath of specPaths) {
        const specFacts = readFacts(specPath);
        if (!specFacts) {
            continue;
        }
        if (specFacts.parsedMockCalls < specFacts.scannedMockCalls) {
            extractionFailures.push(specPath);
        }
        if (specFacts.mocks.length === 0) {
            continue;
        }
        parsedMockCount += specFacts.mocks.length;

        const specDirectory = dirname(specPath);
        const relSpecPath = relative(repoRoot, specPath).split(sep).join('/');
        const mockedPaths = new Set<string>();
        const barrelsUnderTest = new Map<string, MockedBarrel>();
        // Resolved barrel path -> the exemption row muting some of its keys for
        // this spec, if any. A row mutes keys, not the pair, so the barrel stays
        // in `barrelsUnderTest` either way.
        const exemptedKeysFor = new Map<string, { row: ExemptionRow; keys: Set<string> }>();

        for (const mock of specFacts.mocks) {
            const resolved = resolveSpecifier(mock.specifier, specDirectory, fileExists);
            if (!resolved) {
                continue;
            }
            resolvedMockCount += 1;

            // Only a factory that does *not* spread `importOriginal` cuts the module
            // out of the graph. A spread factory loads the real module, so its own
            // imports do execute and can still hit another barrel this spec mocks
            // exhaustively — which means applying the spread repair to one mock used
            // to shrink the gate's coverage of every other barrel in the same file.
            if (!mock.spreadsOriginal) {
                mockedPaths.add(resolved);
            }

            if (mock.spreadsOriginal || !contractBarrelPattern.test(mock.specifier)) {
                continue;
            }

            barrelsUnderTest.set(resolved, mock);
            matchedBarrelKindCounts[kindOfSpecifier(mock.specifier) ?? mock.specifier] =
                (matchedBarrelKindCounts[kindOfSpecifier(mock.specifier) ?? mock.specifier] ?? 0) + 1;

            const matchingRow = inScopeExemptions.find(
                (row) => row.spec === relSpecPath && row.barrel === mock.specifier
            );
            if (matchingRow) {
                matchedPair.add(matchingRow);
                exemptedKeysFor.set(resolved, { row: matchingRow, keys: new Set(matchingRow.missingKeys) });
            }
        }

        if (barrelsUnderTest.size === 0) {
            continue;
        }
        analyzedSpecCount += 1;

        // The mock replaces the module for the whole graph, so every module the
        // spec can reach counts — except the ones the spec mocks *without* a
        // spread, whose real imports never run.
        const visited = new Set<string>([specPath]);
        const queue: string[] = [specPath];

        while (queue.length > 0) {
            const current = queue.pop();
            if (current === undefined) {
                break;
            }
            const facts = readFacts(current);
            if (!facts) {
                continue;
            }
            for (const [specifier, names] of facts.imports) {
                const resolved = resolveSpecifier(specifier, dirname(current), fileExists);
                if (!resolved) {
                    continue;
                }

                const mock = barrelsUnderTest.get(resolved);
                if (mock) {
                    const rawMissing = [...names].filter((name) => name !== '*' && !mock.keys.includes(name));
                    if (names.has('*')) {
                        rawMissing.push('* (namespace import)');
                    }

                    const exemption = exemptedKeysFor.get(resolved);
                    const missing = rawMissing.filter((name) => {
                        if (exemption && exemption.keys.has(name)) {
                            seenKeys.get(exemption.row)?.add(name);
                            return false;
                        }
                        return true;
                    });

                    if (missing.length > 0) {
                        violations.push({
                            spec: specPath,
                            line: mock.line,
                            barrel: mock.specifier,
                            missing: [...new Set(missing)].sort(),
                            usedBy: current,
                        });
                    }
                }

                if (mockedPaths.has(resolved) || visited.has(resolved)) {
                    continue;
                }
                visited.add(resolved);
                queue.push(resolved);
            }
        }

        graphNodeCount += visited.size;
    }

    const staleExemptions: StaleExemption[] = [];
    for (const row of inScopeExemptions) {
        if (!matchedPair.has(row)) {
            staleExemptions.push({ spec: row.spec, barrel: row.barrel, unusedKeys: [...row.missingKeys] });
            continue;
        }
        const seen = seenKeys.get(row) ?? new Set<string>();
        const unusedKeys = row.missingKeys.filter((key) => !seen.has(key));
        if (unusedKeys.length > 0) {
            staleExemptions.push({ spec: row.spec, barrel: row.barrel, unusedKeys });
        }
    }

    return {
        violations,
        extractionFailures,
        parsedMockCount,
        resolvedMockCount,
        analyzedSpecCount,
        graphNodeCount,
        staleExemptions,
        matchedBarrelKindCounts,
    };
}

const specFilePattern = /\.spec\.tsx?$/;
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage', 'target']);

function walkForSpecs(directory: string, found: string[]): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (skippedDirectories.has(entry.name)) {
                continue;
            }
            walkForSpecs(join(directory, entry.name), found);
            continue;
        }
        if (entry.isFile() && specFilePattern.test(entry.name)) {
            found.push(join(directory, entry.name));
        }
    }
    found.sort();
}

/** Scans the real tree. Exported so the guard's spec runs the same scan the CLI does. */
export function scanRepository(
    barrelKinds?: ReadonlyArray<string>,
    exemptionRows?: ReadonlyArray<ExemptionRow>
): AnalysisResult & { specCount: number } {
    const specPaths: string[] = [];
    walkForSpecs(sourceRoot, specPaths);

    const factsCache = new Map<string, FileFacts | null>();
    const existsCache = new Map<string, boolean>();

    const fileExists = (path: string): boolean => {
        const cached = existsCache.get(path);
        if (cached !== undefined) {
            return cached;
        }
        let result = false;
        if (existsSync(path)) {
            result = statSync(path).isFile();
        }
        existsCache.set(path, result);
        return result;
    };

    const readFacts: ReadFacts = (absolutePath) => {
        const cached = factsCache.get(absolutePath);
        if (cached !== undefined) {
            return cached;
        }
        let facts: FileFacts | null;
        try {
            facts = readFileFacts(absolutePath, readFileSync(absolutePath, 'utf8'));
        } catch {
            facts = null;
        }
        factsCache.set(absolutePath, facts);
        return facts;
    };

    return {
        specCount: specPaths.length,
        ...analyzeSpecs({ specPaths, readFacts, fileExists, barrelKinds, exemptions: exemptionRows }),
    };
}

/**
 * The floors below which the analysis is not measuring anything. They are lower
 * than today's real numbers by a wide margin — they exist to separate "clean" from
 * "derived nothing", not to pin the tree. Breaking `fileExists`, `readFacts`, the
 * parser, or the glob puts one of these at zero, which is the whole point.
 */
const derivationFloors = {
    analyzedSpecs: 5,
    resolvedMocks: 50,
    graphNodes: 500,
} as const;

function checkDerivation(result: AnalysisResult): string[] {
    const failures: string[] = [];
    if (result.extractionFailures.length > 0) {
        const sample = result.extractionFailures
            .slice(0, 5)
            .map((path) => `      ${relative(repoRoot, path).split(sep).join('/')}`)
            .join('\n');
        failures.push(
            `  ✗ ${String(result.extractionFailures.length)} spec(s) contain a vi.mock call the parser did not produce.\n` +
                `    The file does not parse, so its mocks are invisible to this check:\n${sample}`
        );
    }
    if (result.analyzedSpecCount < derivationFloors.analyzedSpecs) {
        failures.push(
            `  ✗ only ${String(result.analyzedSpecCount)} spec(s) reached the graph walk (floor ${String(derivationFloors.analyzedSpecs)}). ` +
                'The analysis derived nothing; a clean verdict here would be vacuous.'
        );
    }
    if (result.resolvedMockCount < derivationFloors.resolvedMocks) {
        failures.push(
            `  ✗ only ${String(result.resolvedMockCount)} mock specifier(s) resolved to a file (floor ${String(derivationFloors.resolvedMocks)}), ` +
                `out of ${String(result.parsedMockCount)} parsed. Module resolution is broken.`
        );
    }
    if (result.graphNodeCount < derivationFloors.graphNodes) {
        failures.push(
            `  ✗ only ${String(result.graphNodeCount)} module-graph node(s) were walked (floor ${String(derivationFloors.graphNodes)}). ` +
                'The graph traversal is not reaching the modules that use the mocked barrels.'
        );
    }
    return failures;
}

/**
 * Human-readable report for one violation; shared by the CLI and the guard spec.
 *
 * Remedy order matters, and it used to be wrong. The violation is "this factory
 * omits X", and adding a stub for X costs nothing; spreading the barrel loads the
 * real module and everything behind it. Printing only the spread sent developers
 * to the expensive fix with no hint that the cheap one exists — on
 * `src/app/__tests__/App.spec.tsx`, whose exhaustive mock exists precisely so the
 * composition root does not load the whole DAW, that trade is 573ms → 20.89s.
 * Cheapest first, then the spread, then the exemption table, which is a real exit
 * and must be findable from the failure rather than only from this source file.
 */
export function formatViolation(violation: Violation): string {
    const spec = relative(repoRoot, violation.spec).split(sep).join('/');
    const usedBy = relative(repoRoot, violation.usedBy).split(sep).join('/');
    return [
        `  ✗ ${spec}:${violation.line}`,
        `    mocks ${violation.barrel} without spreading importOriginal,`,
        `    and omits ${violation.missing.join(', ')} — imported by ${usedBy}.`,
        '',
        `    Cheapest fix — add the missing key(s) to the factory: ${violation.missing.join(', ')}.`,
        '      Costs nothing: the factory keeps replacing the whole barrel.',
        '    Or spread the barrel so later additions resolve for free:',
        "      vi.mock(spec, async (importOriginal) => ({ ...(await importOriginal<typeof import('…')>()), …overrides }))",
        '      Loads the real module and its graph — measure before choosing this for a heavy barrel.',
        '    Or, if the mock is deliberately narrower than the graph, add a reasoned row to',
        '      `exemptions` in scripts/checkBarrelMockCoverage.ts. That is a documented exit,',
        '      not evasion: the row carries the spec, the barrel and the reason, and is reviewed.',
    ].join('\n');
}

const usage = [
    'pnpm test:barrel-mocks [--all] [--help]',
    '',
    `  (no flags)  Fail when a spec mocks a ${gatedBarrelKinds.join(', ')} contract barrel`,
    '              without spreading importOriginal and omits an export its own module',
    '              graph imports from that barrel. This is the gate; it must stay at zero.',
    `  --all       Report the same violation across all ${String(allBarrelKinds.length)} contract barrels`,
    `              (${allBarrelKinds.join(', ')}). The kinds outside the gate`,
    '              carry pre-existing debt this measures rather than blocks. Exits 1',
    '              when it finds any, so it is a measurement command, not a check.',
    '  --help      This text.',
    '',
    'Remedies, cheapest first: add the missing key to the factory; spread the barrel;',
    'or add a reasoned row to `exemptions` in scripts/checkBarrelMockCoverage.ts.',
    'Background: docs/06-testing.md §5.1, and PR #1572.',
].join('\n');

function main(): number {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(usage);
        return 0;
    }

    const scanAll = process.argv.includes('--all');
    const kinds = scanAll ? allBarrelKinds : gatedBarrelKinds;
    const result = scanRepository(kinds);

    const derivationFailures = checkDerivation(result);
    if (derivationFailures.length > 0) {
        console.error('\nbarrel mock coverage: the analysis derived too little to have a verdict\n');
        console.error(derivationFailures.join('\n\n'));
        console.error('');
        return 1;
    }

    if (result.violations.length > 0) {
        const uniquePairs = new Set(result.violations.map((violation) => `${violation.spec} ${violation.barrel}`));
        const uniqueSpecs = new Set(result.violations.map((violation) => violation.spec));
        console.error(
            `\nbarrel mock coverage (${kinds.join(', ')}): ${String(result.violations.length)} violation(s) — ` +
                `${String(uniquePairs.size)} unique (spec, barrel) pair(s) across ${String(uniqueSpecs.size)} spec file(s)\n`
        );
        console.error(result.violations.map(formatViolation).join('\n\n'));
        console.error('');
        return 1;
    }

    if (result.staleExemptions.length > 0) {
        console.error(
            '\nbarrel mock coverage: stale `exemptions` row(s) in scripts/checkBarrelMockCoverage.ts — ' +
                'the graph no longer needs what these rows mute\n'
        );
        for (const stale of result.staleExemptions) {
            console.error(
                stale.unusedKeys.length === 0
                    ? `  ✗ ${stale.spec} — ${stale.barrel}\n    This row never matched a mocked pair this run. Delete it.`
                    : `  ✗ ${stale.spec} — ${stale.barrel}\n` +
                          `    Lists ${stale.unusedKeys.join(', ')} in missingKeys, but the graph walk never found ` +
                          'them missing. Narrow the row to the names still real, or delete it.'
            );
        }
        console.error('');
        return 1;
    }

    // Say what was actually analysed, not what was globbed. "3370 spec files
    // scanned" was true and misleading: 3370 is the glob, and it stays 3370 when
    // resolution is broken and nothing at all is checked. Naming the kinds here
    // matters just as much: printing "barrel" with no qualifier is how a reader
    // mistakes this for full coverage — the kinds outside the gate carry debt this
    // run did not look at (`--all` measures it), and this line is the only place
    // that scope is stated at the moment someone reads the result.
    console.log(
        `barrel mock coverage (${kinds.join(', ')}): OK — ${String(result.analyzedSpecCount)} of ` +
            `${String(result.specCount)} spec files mock one of these barrel kinds without a spread; ` +
            `${String(result.resolvedMockCount)} mock specifier(s) resolved, ` +
            `${String(result.graphNodeCount)} module-graph node(s) walked`
    );
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
