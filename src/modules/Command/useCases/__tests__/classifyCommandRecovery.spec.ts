import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { classifyCommandRecovery } from '../classifyCommandRecovery';

const INVERSE_ACTION: AppAction = { type: 'renameTrack', payload: { trackId: 'track-1', name: 'Old' } };

describe('classifyCommandRecovery', () => {
    // Red when the classifier stops requiring `undoable` alongside the declared inverse.
    it('reports an inverse only when an undoable handler declares one', () => {
        expect(classifyCommandRecovery({ undoable: true }, { label: 'Rename', inverseAction: INVERSE_ACTION })).toBe(
            'inverse'
        );
        expect(classifyCommandRecovery({ undoable: false }, { label: 'Rename', inverseAction: INVERSE_ACTION })).toBe(
            'compensable'
        );
    });

    // Red when abort preparation stops counting as a compensation path.
    it('reports compensable for an abort-prepared handler with no declared inverse', () => {
        expect(classifyCommandRecovery({ undoable: false, prepareAbort: () => () => {} }, { label: 'Rename' })).toBe(
            'compensable'
        );
    });

    // Red when a handler with neither an inverse nor an abort path is treated as recoverable.
    it('reports irreversible when the handler offers neither an inverse nor an abort path', () => {
        expect(classifyCommandRecovery({ undoable: true }, { label: 'Rename' })).toBe('irreversible');
    });
});
