import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { bindCanonicalRedoAction } from '../bindCanonicalRedoAction';
import { captureRecordedRedoContext } from '../captureRecordedRedoContext';
import { createUndoEntry } from '../createUndoEntry';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { findPendingRedoEntry } from '../findPendingRedoEntry';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';

function rename(name: string): AppAction {
    return { type: 'renameTrack', payload: { trackId: 'track', name } };
}

describe('canonical Redo action identity', () => {
    beforeEach(() => {
        resetActionReplayAuthority();
        clearHandlerRegistry();
    });
    afterEach(() => {
        undoStore.set({ past: [], future: [] });
        resetActionReplayAuthority();
        clearHandlerRegistry();
    });

    function pending() {
        const action = rename('After');
        const entry = createUndoEntry('Rename', action, rename('Before'));
        undoStore.set({ past: [], future: [entry] });
        return { action, entry };
    }

    it('keeps the original request and only its registered canonical clone bound', () => {
        const { action, entry } = pending();
        const canonical = structuredClone(action);
        const context = captureRecordedRedoContext(action);
        expect(findPendingRedoEntry(canonical)).toBeUndefined();
        bindCanonicalRedoAction(action, canonical, context);
        expect(findPendingRedoEntry(action)).toBe(entry);
        expect(findPendingRedoEntry(canonical)).toBe(entry);
        expect(findPendingRedoEntry(structuredClone(canonical))).toBeUndefined();
    });

    it.each(['single', 'batch'] as const)(
        'binds only the dispatcher-produced canonical action through %s dispatch',
        async (route) => {
            const { action, entry } = pending();
            let observed: AppAction | undefined;
            registerHandlerMap({
                renameTrack: createHandler<'renameTrack'>({
                    materializeCommandArguments: () => undefined,
                    describe: () => ({ label: 'Rename', inverseAction: rename('Before') }),
                    execute: (canonical) => {
                        observed = canonical;
                        expect(canonical).not.toBe(action);
                        expect(findPendingRedoEntry(canonical)).toBe(entry);
                        return { status: 'written' };
                    },
                    undoable: true,
                }),
            });
            if (route === 'single') {
                await executeAppAction(action, { skipUndo: true, skipMacroRecording: true });
            } else {
                expect(
                    await executeAppActionBatch([action], { skipUndo: true, skipMacroRecording: true })
                ).toMatchObject({ status: 'committed' });
            }
            expect(observed).toEqual(action);
            expect(findPendingRedoEntry(structuredClone(action))).toBeUndefined();
        }
    );

    it('prefers a new genuine pending request over its retired canonical alias', () => {
        const { action } = pending();
        const canonical = structuredClone(action);
        const context = captureRecordedRedoContext(action);
        bindCanonicalRedoAction(action, canonical, context);
        const replacement = createUndoEntry('New request', canonical, rename('New before'));
        undoStore.set({ past: [], future: [replacement] });
        expect(context?.isCurrent()).toBe(false);
        expect(findPendingRedoEntry(canonical)).toBe(replacement);
    });

    it('rejects caller-created contexts and a real context borrowed for another request', () => {
        const { action, entry } = pending();
        const canonical = structuredClone(action);
        bindCanonicalRedoAction(action, canonical, { inverseAction: entry.inverseAction, isCurrent: () => true });
        expect(findPendingRedoEntry(canonical)).toBeUndefined();
        const context = captureRecordedRedoContext(action);
        bindCanonicalRedoAction(structuredClone(action), canonical, context);
        expect(findPendingRedoEntry(canonical)).toBeUndefined();
    });

    it('cannot bind an object already owned by a different pending entry', () => {
        const { action, entry } = pending();
        const otherAction = rename('Other');
        const other = createUndoEntry('Other', otherAction, rename('Other before'));
        undoStore.set({ past: [], future: [entry, other] });
        const canonical = structuredClone(otherAction);
        bindCanonicalRedoAction(otherAction, canonical, captureRecordedRedoContext(otherAction));
        bindCanonicalRedoAction(action, canonical, captureRecordedRedoContext(action));
        expect(findPendingRedoEntry(canonical)).toBe(other);
        bindCanonicalRedoAction(action, otherAction, captureRecordedRedoContext(action));
        expect(findPendingRedoEntry(otherAction)).toBe(other);
    });

    it.each(['inverse', 'entry', 'request', 'reset'] as const)(
        'retires a canonical binding when its %s changes',
        (change) => {
            const { action, entry } = pending();
            const canonical = structuredClone(action);
            const context = captureRecordedRedoContext(action);
            bindCanonicalRedoAction(action, canonical, context);
            if (change === 'inverse') {
                entry.inverseAction = rename('New inverse');
            } else if (change === 'entry') {
                const replacement = structuredClone(entry);
                replacement.action = action;
                replacement.inverseAction = entry.inverseAction;
                undoStore.set({ past: [], future: [replacement] });
            } else if (change === 'request') {
                entry.redoAction = structuredClone(action);
            } else {
                resetActionReplayAuthority();
            }
            expect(context?.isCurrent()).toBe(false);
            expect(findPendingRedoEntry(canonical)).toBeUndefined();
        }
    );
});
