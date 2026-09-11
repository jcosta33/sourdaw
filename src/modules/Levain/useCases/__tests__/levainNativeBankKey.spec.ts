import { describe, expect, it } from 'vitest';

import { toLevainDeviceState } from '../../models/LevainDeviceState';
import { levainInstrumentIdFromNativeBankKey, levainNativeBankKey } from '../../models/LevainNativeBankKey';
import { createDefaultPatch } from '../../models/LevainPatch';
import { nativeBankKeyForLevainDeviceState } from '../levainNativeBankKey';

describe('levainNativeBankKey', () => {
    it('keys a bank by instrument, so two strips on one instrument share it', () => {
        expect(levainNativeBankKey('violin-1')).toBe(levainNativeBankKey('violin-1'));
        expect(levainNativeBankKey('violin-1')).not.toBe(levainNativeBankKey('cello'));
    });

    it('round-trips the instrument back out of its own key', () => {
        expect(levainInstrumentIdFromNativeBankKey(levainNativeBankKey('cello'))).toBe('cello');
    });

    it('disowns a key another module minted', () => {
        expect(levainInstrumentIdFromNativeBankKey('toaster:kit-1')).toBeNull();
    });

    it('disowns a key naming an instrument this build cannot load', () => {
        // Validated rather than trusted: an unknown id would otherwise surface
        // as a 404 on the manifest several async hops later.
        expect(levainInstrumentIdFromNativeBankKey('levain:not-an-instrument')).toBeNull();
    });

    it('reads the key a saved device sounds off its own state', () => {
        const deviceState = toLevainDeviceState(createDefaultPatch('cello'));

        expect(nativeBankKeyForLevainDeviceState({ deviceState })).toBe(levainNativeBankKey('cello'));
    });

    it('answers null for state that names no loadable instrument', () => {
        // Not a default instrument: the mapper refuses a Levain device naming no
        // bank, which is what tells a musician the device did not load.
        expect(nativeBankKeyForLevainDeviceState({ deviceState: { version: 1, data: {} } })).toBeNull();
    });
});
