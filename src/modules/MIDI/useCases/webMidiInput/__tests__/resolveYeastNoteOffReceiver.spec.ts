import { describe, expect, it } from 'vitest';

import { resolveYeastNoteOffReceiver } from '../resolveYeastNoteOffReceiver';

describe('resolveYeastNoteOffReceiver', () => {
    it.each([
        ['fermenter', 'fermenterControls'],
        ['levain', 'levainControls'],
        ['grand-boule', 'grandBouleControls'],
        ['builtin-crumbs', 'crumbsControls'],
    ] as const)('addresses a %s receiver through its note controls', (type, controlsKey) => {
        expect(resolveYeastNoteOffReceiver([{ id: 'device-1', type }], false)).toEqual({
            id: 'device-1',
            type,
            controlsKey,
        });
    });

    it('picks the first instrument in chain order', () => {
        const devices = [
            { id: 'levain-1', type: 'levain' },
            { id: 'fermenter-1', type: 'fermenter' },
        ];

        expect(resolveYeastNoteOffReceiver(devices, false)).toEqual({
            id: 'levain-1',
            type: 'levain',
            controlsKey: 'levainControls',
        });
    });

    it('skips effects ahead of the instrument', () => {
        const devices = [
            { id: 'reverb-1', type: 'builtin-reverb' },
            { id: 'crumbs-1', type: 'builtin-crumbs' },
        ];

        expect(resolveYeastNoteOffReceiver(devices, false)?.id).toBe('crumbs-1');
    });

    it('returns null for a chain with no instrument', () => {
        expect(resolveYeastNoteOffReceiver([{ id: 'reverb-1', type: 'builtin-reverb' }], false)).toBeNull();
    });

    it('returns null when the receiver has no worklet note controls', () => {
        expect(resolveYeastNoteOffReceiver([{ id: 'toaster-1', type: 'toaster' }], true)).toBeNull();
        expect(resolveYeastNoteOffReceiver([{ id: 'synth-1', type: 'builtin-synth' }], false)).toBeNull();
    });
});
