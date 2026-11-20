import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { BUILTIN_PLUGINS } from '../DeviceParameter';

// Ids older projects carry that the catalog no longer lists as creatable devices.
const LEGACY_ALIASES: readonly string[] = ['drum-kit', 'synth'];

// Faust modules are registered at runtime and are not built-in vocabulary.
const catalogBuiltinIds = BUILTIN_PLUGINS.map((descriptor) => descriptor.id).filter((id) => !id.startsWith('faust-'));

describe('the built-in device vocabulary and the catalog', () => {
    it('lists every non-Faust catalog id in the vocabulary, exactly', () => {
        const vocabulary: ReadonlySet<string> = new Set(BUILTIN_DEVICE_TYPES);

        expect(catalogBuiltinIds.filter((id) => !vocabulary.has(id))).toEqual([]);
    });

    it('has a catalog descriptor for every vocabulary id except the legacy aliases', () => {
        const catalog = new Set(catalogBuiltinIds);

        expect(
            BUILTIN_DEVICE_TYPES.filter((deviceType) => !LEGACY_ALIASES.includes(deviceType) && !catalog.has(deviceType))
        ).toEqual([]);
    });

    it('keeps the legacy aliases out of the creatable catalog', () => {
        expect(catalogBuiltinIds.filter((id) => LEGACY_ALIASES.includes(id))).toEqual([]);
    });
});
