import { describe, it, expect, beforeEach } from 'vitest';

import { type ActionHandler } from '../../useCases/commandQueries';
import { clearHandlerRegistry, getHandlerMap, registerHandlerMap } from '../handlerRegistry';

// A minimal stub handler; the registry never invokes it in these tests.
function stub(label: string): ActionHandler {
    return {
        undoable: false,
        execute: () => {},
        describe: () => ({ label }),
    };
}

describe('handlerRegistry / registerHandlerMap', () => {
    beforeEach(() => {
        clearHandlerRegistry();
    });

    it('merges disjoint handler maps into one registry', () => {
        registerHandlerMap({ togglePlayback: stub('a') });
        registerHandlerMap({ stopPlayback: stub('b') });

        const map = getHandlerMap();
        expect(Object.keys(map).sort()).toEqual(['stopPlayback', 'togglePlayback']);
    });

    it('throws on a duplicate action-type registration (one handler per action type)', () => {
        registerHandlerMap({ togglePlayback: stub('first') });

        expect(() => registerHandlerMap({ togglePlayback: stub('second') })).toThrow(
            /Duplicate handler for action type: togglePlayback/
        );
    });

    it('throws on a duplicate even when it is in the same registration batch as a new key', () => {
        registerHandlerMap({ togglePlayback: stub('first') });

        expect(() => registerHandlerMap({ stopPlayback: stub('new'), togglePlayback: stub('dup') })).toThrow(
            /Duplicate handler for action type: togglePlayback/
        );
    });

    it('does not let a rejected duplicate overwrite the first registration', () => {
        const first = stub('first');
        registerHandlerMap({ togglePlayback: first });
        try {
            registerHandlerMap({ togglePlayback: stub('second') });
        } catch {
            /* expected */
        }
        expect(getHandlerMap().togglePlayback).toBe(first);
    });
});
