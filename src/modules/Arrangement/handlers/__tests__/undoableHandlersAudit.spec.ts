import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

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

/**
 * Inverse-action handlers introduced for issue #2365. Each unwinds a forward command,
 * so each must be registered — an unregistered inverse makes undo a silent no-op —
 * and none may be undoable, because a handler that records an undo entry while
 * unwinding the stack stops undo from converging.
 */
const INVERSE_ACTION_HANDLERS = [
    'restoreTrackDisabled',
    'restoreMidiOutput',
    'restoreTrackInput',
    'restoreFreezeState',
    'restoreReversedClip',
    'restoreTrackGroupMemberships',
    'restoreTrackHeights',
    'restoreTracks',
    'discardCreatedTracks',
    'restoreTimeOperationState',
    'restoreTrackClipStates',
    'restoreScratchPadState',
    'discardCreatedCompGroup',
    'restoreTrackAlternativeState',
];

function collectSpecFiles(directory: string, found: string[] = []): string[] {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            collectSpecFiles(path, found);
            continue;
        }
        if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) {
            found.push(path);
        }
    }
    return found;
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

    it('registers every inverse-action handler introduced for undo', () => {
        const registered = new Set(handlerEntries().map(([type]) => type));
        const missing = INVERSE_ACTION_HANDLERS.filter((type) => !registered.has(type)).sort();

        expect(missing).toEqual([]);
    });

    it('never marks an inverse-action handler undoable', () => {
        const handlers = new Map(handlerEntries());
        const undoableInverses = INVERSE_ACTION_HANDLERS.filter((type) => handlers.get(type)?.undoable === true).sort();

        expect(undoableInverses).toEqual([]);
    });
});
