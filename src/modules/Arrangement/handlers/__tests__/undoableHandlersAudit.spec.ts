import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    type ConciseBody,
    type Expression,
    type Node,
    type SourceFile,
    ScriptKind,
    ScriptTarget,
    SyntaxKind,
    createSourceFile,
    forEachChild,
    isArrowFunction,
    isAsExpression,
    isBinaryExpression,
    isBlock,
    isCallExpression,
    isConditionalExpression,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isNonNullExpression,
    isObjectLiteralExpression,
    isParenthesizedExpression,
    isPropertyAssignment,
    isReturnStatement,
    isSatisfiesExpression,
    isShorthandPropertyAssignment,
    isStringLiteral,
    isVariableDeclaration,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';

import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';

const ARRANGEMENT_ROOT = resolve(__dirname, '../..');

/**
 * Undoable handlers with no spec naming their action. Fail-closed: the audit asserts
 * this set EXACTLY, so covering one of these forces its removal here, and a newly
 * registered undoable handler cannot be waved through by leaving the list alone.
 *
 * `importStemSet` predates this audit and is tracked separately; it emits an inverse
 * and creates tracks, so it is untested undo on a destructive command.
 */
const UNCOVERED_UNDOABLE_HANDLERS = ['importStemSet'];

/** `importStemSet`'s inverse, uncovered for the same reason and tracked with it. */
const UNCOVERED_INVERSE_ACTIONS = ['discardImportedStemSet'];

/**
 * The action types Arrangement sources name as an `inverseAction` or a `redoAction`,
 * read off the syntax tree.
 *
 * Derived rather than listed. A written-down list only ever audits the names someone
 * remembered to add to it, so the handler it would most want to catch — a new one whose
 * author never touched this file — is exactly the one it misses.
 *
 * Deriving it with a regular expression did not work. The one this replaced required `{`
 * immediately after the key, and that is the minority shape here: `setAutomationMode`
 * writes `inverseAction: track ? { … } : null`, and the track mute, solo, arm, rename,
 * colour and pan handlers, the clip gain, fade, loop, lock and mute handlers, bypass
 * device, add and remove send, and the marker and section removals are all written the
 * same way. Every one of them was invisible to it.
 *
 * WHAT THIS READS. From an `inverseAction:`/`redoAction:` property — longhand or
 * shorthand — it follows the value through conditionals, `??`, `||` and `&&`,
 * parentheses, `as`/`satisfies`/`!`, a reference to a file-local `const`, and a call to a
 * file-local function, and takes the **own** `type` property of every object literal it
 * reaches.
 *
 * WHAT IT STILL CANNOT SEE, named here rather than papered over:
 *  - a `type` arriving through a spread instead of an own property, as in `handleCreateBus`'s
 *    `{ ...inverseAction, payload }`;
 *  - a value read off another object, or returned by an imported function, since neither
 *    is resolvable within one file;
 *  - a `type` that is not a string literal.
 * Each is a real gap, and none is an argument for going back to a list: the list saw none
 * of them either, and unlike this it also missed the ordinary shapes.
 *
 * It does not descend into a matched literal's nested objects, deliberately. A payload can
 * carry a `type` field of its own — `handleLoadPreset` builds device snapshots that do —
 * and reading one would put a name belonging to no handler into the registration audit
 * below, reddening this spec over a handler that does not exist.
 *
 * `redoAction: action` re-dispatches the forward action and names no separate handler. It
 * resolves to a parameter rather than a `const`, so it contributes nothing, which is right.
 */
const INVERSE_ACTION_KEYS = new Set(['inverseAction', 'redoAction']);

/** `??`, `||` and `&&`: each yields one of its two operands, so both can be the action. */
const FALLBACK_OPERATORS = new Set([
    SyntaxKind.QuestionQuestionToken,
    SyntaxKind.BarBarToken,
    SyntaxKind.AmpersandAmpersandToken,
]);

/**
 * What a function body can hand back. Nested functions are skipped: a callback's `return`
 * is its own result, not the enclosing function's, and attributing it would invent a name.
 */
function returnExpressions(body: ConciseBody | undefined): Expression[] {
    if (!body) {
        return [];
    }
    if (!isBlock(body)) {
        return [body];
    }
    const found: Expression[] = [];
    const visit = (node: Node): void => {
        if (isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node)) {
            return;
        }
        if (isReturnStatement(node) && node.expression) {
            found.push(node.expression);
        }
        forEachChild(node, visit);
    };
    forEachChild(body, visit);
    return found;
}

/**
 * File-local names an inverse expression can stand behind: `const` initializers and the
 * expressions functions declared in the same file return.
 *
 * A name is mapped to every declaration carrying it rather than to one, because two blocks
 * in a file may each declare `const inverse`. Resolving both over-approximates only when a
 * name shadows another, and the alternative — resolving neither — loses real inverses.
 */
type LocalScope = {
    readonly values: ReadonlyMap<string, readonly Expression[]>;
    readonly returns: ReadonlyMap<string, readonly Expression[]>;
};

function readLocalScope(file: SourceFile): LocalScope {
    const values = new Map<string, Expression[]>();
    const returns = new Map<string, Expression[]>();
    const push = (into: Map<string, Expression[]>, name: string, expressions: Expression[]): void => {
        into.set(name, [...(into.get(name) ?? []), ...expressions]);
    };
    const visit = (node: Node): void => {
        if (isFunctionDeclaration(node) && node.name) {
            push(returns, node.name.text, returnExpressions(node.body));
        }
        if (isVariableDeclaration(node) && isIdentifier(node.name) && node.initializer) {
            if (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer)) {
                push(returns, node.name.text, returnExpressions(node.initializer.body));
            } else {
                push(values, node.name.text, [node.initializer]);
            }
        }
        forEachChild(node, visit);
    };
    visit(file);
    return { values, returns };
}

/** Strips the wrappers that carry a value through unchanged, so `{ … } as const` and
 *  `(x)!` are read as the value inside rather than as opaque expressions. */
function unwrap(expression: Expression): Expression {
    if (
        isParenthesizedExpression(expression) ||
        isAsExpression(expression) ||
        isSatisfiesExpression(expression) ||
        isNonNullExpression(expression)
    ) {
        return unwrap(expression.expression);
    }
    return expression;
}

function collectActionTypes(expression: Expression, scope: LocalScope, into: Set<string>, seen: Set<Expression>): void {
    const node = unwrap(expression);
    // A `const` can be reached twice, and `const x = flag ? x : y` would otherwise recur
    // forever. Every type it named is already in `into` by the second visit.
    if (seen.has(node)) {
        return;
    }
    seen.add(node);
    if (isConditionalExpression(node)) {
        collectActionTypes(node.whenTrue, scope, into, seen);
        collectActionTypes(node.whenFalse, scope, into, seen);
        return;
    }
    if (isBinaryExpression(node) && FALLBACK_OPERATORS.has(node.operatorToken.kind)) {
        collectActionTypes(node.left, scope, into, seen);
        collectActionTypes(node.right, scope, into, seen);
        return;
    }
    if (isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
            if (!isPropertyAssignment(property) || !isIdentifier(property.name) || property.name.text !== 'type') {
                continue;
            }
            const value = unwrap(property.initializer);
            if (isStringLiteral(value)) {
                into.add(value.text);
            }
        }
        return;
    }
    if (isIdentifier(node)) {
        for (const initializer of scope.values.get(node.text) ?? []) {
            collectActionTypes(initializer, scope, into, seen);
        }
        return;
    }
    if (isCallExpression(node) && isIdentifier(node.expression)) {
        for (const returned of scope.returns.get(node.expression.text) ?? []) {
            collectActionTypes(returned, scope, into, seen);
        }
    }
}

/** Exercised directly by the ternary case below, on a real handler, so the extraction is
 *  proved against production syntax rather than a fixture shaped to match it. */
function readInverseActionTypesInSource(path: string, text: string): string[] {
    const file = createSourceFile(
        path,
        text,
        ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS
    );
    const scope = readLocalScope(file);
    const types = new Set<string>();
    const seen = new Set<Expression>();
    const visit = (node: Node): void => {
        if (isPropertyAssignment(node) && isIdentifier(node.name) && INVERSE_ACTION_KEYS.has(node.name.text)) {
            collectActionTypes(node.initializer, scope, types, seen);
        }
        if (isShorthandPropertyAssignment(node) && INVERSE_ACTION_KEYS.has(node.name.text)) {
            collectActionTypes(node.name, scope, types, seen);
        }
        forEachChild(node, visit);
    };
    visit(file);
    return [...types].sort();
}

function collectFiles(directory: string, matches: (name: string) => boolean, found: string[] = []): string[] {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            collectFiles(path, matches, found);
            continue;
        }
        if (matches(entry.name)) {
            found.push(path);
        }
    }
    return found;
}

function isSpecFile(name: string): boolean {
    return name.endsWith('.spec.ts') || name.endsWith('.spec.tsx');
}

function collectSpecFiles(directory: string, found: string[] = []): string[] {
    return collectFiles(directory, isSpecFile, found);
}

function isSourceFile(name: string): boolean {
    return (name.endsWith('.ts') || name.endsWith('.tsx')) && !isSpecFile(name);
}

/** Reads the set off the Arrangement sources, skipping specs — a spec quoting an
 *  inverse in an assertion is describing a handler, not declaring one. */
function readInverseActionTypes(): string[] {
    const types = new Set<string>();
    for (const path of collectFiles(ARRANGEMENT_ROOT, isSourceFile)) {
        for (const type of readInverseActionTypesInSource(path, readFileSync(path, 'utf8'))) {
            types.add(type);
        }
    }
    return [...types].sort();
}

/** Every Arrangement spec, concatenated, so coverage is read off the corpus that
 *  actually exists rather than a list in this file that drifts the day it is written. */
function readSpecCorpus(): string {
    return collectSpecFiles(ARRANGEMENT_ROOT)
        .filter((path) => !path.endsWith('undoableHandlersAudit.spec.ts'))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n');
}

function handlerEntries() {
    return Object.entries(getArrangementHandlers());
}

describe('Arrangement undoable handlers audit', () => {
    it('resolves a registry with undoable handlers in it', () => {
        // Guards every audit below: each one passes vacuously against an empty or
        // unresolvable registry, which is exactly how this audit could go green while
        // observing nothing at all.
        expect(handlerEntries().filter(([, handler]) => handler.undoable).length).toBeGreaterThan(0);
    });

    it('covers every undoable handler with a spec that names its action', () => {
        const corpus = readSpecCorpus();
        const uncovered = handlerEntries()
            .filter(([, handler]) => handler.undoable)
            .map(([type]) => type)
            .filter((type) => !corpus.includes(`'${type}'`))
            .sort();

        // Registry growth fails here: a newly registered undoable handler has no spec
        // naming its action type until someone writes one. This is a coverage floor,
        // not proof of behaviour — the round trips that prove an inverse actually
        // restores the original state live in the `*.integration.spec.ts` files this
        // corpus includes.
        expect(uncovered).toEqual([...UNCOVERED_UNDOABLE_HANDLERS].sort());
    });

    it('reads inverse-action types off the Arrangement sources', () => {
        // Guards the two audits below the same way the registry check guards the rest:
        // a regex that stopped matching would leave them iterating an empty set and
        // passing while observing nothing. The floor sits far below the live count so
        // ordinary churn never touches it.
        expect(readInverseActionTypes().length).toBeGreaterThan(5);
    });

    it('reads an inverse written behind a ternary, not only a direct object literal', () => {
        // `setAutomationMode.ts` writes `inverseAction: track ? { type: … } : null` — a
        // real, registered, unconditional inverse in the shape most handlers here use.
        // Reading that one file on its own is what makes this discriminating: asserting
        // only against the whole set would pass on any other file naming the same type.
        const path = join(ARRANGEMENT_ROOT, 'handlers', 'track', 'setAutomationMode.ts');
        expect(readInverseActionTypesInSource(path, readFileSync(path, 'utf8'))).toContain('setAutomationMode');
        expect(readInverseActionTypes()).toContain('setAutomationMode');
    });

    it('registers every action type named as an inverse or redo action', () => {
        // An Arrangement command may unwind through another module's handler —
        // `arpeggiate` restores through MIDI's `restoreMidiClipNotes` — so the registry
        // this checks against is every registry an Arrangement inverse can name.
        const registered = new Set([
            ...handlerEntries().map(([type]) => type),
            ...Object.keys(getMidiNoteTransformHandlers()),
        ]);
        const missing = readInverseActionTypes().filter((type) => !registered.has(type));

        // An unregistered inverse makes undo a silent no-op: the entry is popped, the
        // dispatch resolves to nothing, and the edit stays applied.
        expect(missing).toEqual([]);
    });

    it('covers every action type named as an inverse or redo action with a spec', () => {
        const corpus = readSpecCorpus();
        const uncovered = readInverseActionTypes().filter((type) => !corpus.includes(`'${type}'`));

        // The coverage floor above only sees handlers marked `undoable`, which is the
        // forward half of every pair. An inverse is the half that runs when a musician
        // is trying to get work back, and a dedicated one — `restoreTrackClipStates`,
        // `discardCreatedTracks` — is not `undoable` and so is invisible there.
        expect(uncovered).toEqual([...UNCOVERED_INVERSE_ACTIONS].sort());
    });
});
