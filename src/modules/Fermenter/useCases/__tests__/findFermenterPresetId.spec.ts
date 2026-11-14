import { describe, expect, it } from 'vitest';

import { cloneFermenterPatch } from '../../models/FermenterPatchState';
import { resolveFermenterPresetPatch } from '../fermenterPatchOperations';
import { findFermenterPresetId } from '../findFermenterPresetId';

describe('findFermenterPresetId', () => {
    it('resolves the actual hydrated factory patch and rejects a same-name edited patch', () => {
        const patch = resolveFermenterPresetPatch('fermenter-init', []);
        if (!patch) {
            throw new Error('Expected Blank Dough factory patch');
        }
        expect(findFermenterPresetId(patch, [])).toBe('fermenter-init');
        const modified = cloneFermenterPatch(patch);
        modified.macros[0] = 0.87;
        expect(findFermenterPresetId(modified, [])).toBeNull();
    });

    it('uses complete nested user-patch identity rather than a duplicate display name', () => {
        const patch = resolveFermenterPresetPatch('fermenter-init', []);
        if (!patch) {
            throw new Error('Expected factory patch');
        }
        const first = cloneFermenterPatch(patch);
        first.name = 'My sound';
        const second = cloneFermenterPatch(first);
        second.macroMappings![0]!.targets[0]!.center = 880;
        const userPatches = [
            { id: 'first', name: 'My sound', patch: first },
            { id: 'second', name: 'My sound', patch: second },
        ];
        expect(findFermenterPresetId(second, userPatches)).toBe('second');
    });
});
