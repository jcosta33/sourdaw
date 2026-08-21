import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
 * Every action type any Arrangement source names as an `inverseAction` or a
 * `redoAction` object literal.
 *
 * Derived rather than listed. A written-down list only ever audits the names someone
 * remembered to add to it, so the handler it would most want to catch — a new one
 * whose author never touched this file — is exactly the one it misses. Reading the
 * sources means a new inverse enters this audit the moment it is written.
 *
 * A `redoAction` that re-dispatches the forward action (`redoAction: action`) is not
 * an object literal and is correctly absent: it names no separate handler.
 */
const INVERSE_ACTION_LITERAL = /(?:inverseAction|redoAction):\s*\{[^}]*?type:\s*'([A-Za-z][A-Za-z0-9]*)'/g;

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
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(INVERSE_ACTION_LITERAL)) {
            types.add(match[1]!);
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
