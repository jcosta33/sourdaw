import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { hasOwnPresetExplorer } from '../DevicePresetExplorerByDeviceType';

const OWN_EXPLORER = ['fermenter', 'toaster', 'levain', 'builtin-crumbs', 'grand-boule'];

describe('hasOwnPresetExplorer', () => {
    it.each(BUILTIN_DEVICE_TYPES.map((type) => [type, OWN_EXPLORER.includes(type)] as const))(
        'answers %s as %s',
        (type, expected) => {
            expect(hasOwnPresetExplorer(type)).toBe(expected);
        }
    );

    it.each(['Fermenter', 'KNEAD', 'knead', 'external-plugin', '', 'constructor', '__proto__', 'faust-x'])(
        'answers false for %j',
        (type) => {
            expect(hasOwnPresetExplorer(type)).toBe(false);
        }
    );
});
