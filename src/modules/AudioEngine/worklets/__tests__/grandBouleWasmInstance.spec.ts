import { describe, expect, it } from 'vitest';

import { createGrandBouleWasmInstance } from '../grandBouleWasmInstance';

describe('Grand Boule WASM construction seam', () => {
    it('has no production constructor while Grand Boule is release-withheld', () => {
        expect(() => createGrandBouleWasmInstance(48_000, 64)).toThrow(
            'Grand Boule has no constructor in distributed daw-dsp WASM'
        );
    });
});
