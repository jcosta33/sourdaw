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
        // A chunk is present and unreadable, which is a device that did not
        // load. Substituting the default here would sound a different
        // instrument than the file asked for and say nothing about it.
        expect(nativeBankKeyForLevainDeviceState({ deviceState: { version: 1, data: {} } })).toBeNull();
    });

    it('answers null for a chunk whose instrument id is not even a string', () => {
        expect(
            nativeBankKeyForLevainDeviceState({ deviceState: { version: 1, data: { instrumentId: 42 } } })
        ).toBeNull();
    });

    it('names the default instrument for a device that has committed no chunk', () => {
        // `initLevainDeviceStatePersistence` records a fresh device without
        // committing a chunk, and the Web Audio carrier plays
        // `createDefaultPatch`'s instrument for it. Answering `null` instead
        // would put a device naming no bank on the wire, and `map_device`
        // refuses the batch whole over one on an audible strip — so a project
        // with one untouched Levain would decline native carriage entirely.
        expect(nativeBankKeyForLevainDeviceState({ deviceState: undefined })).toBe('levain:violin-1');
        expect(nativeBankKeyForLevainDeviceState({ deviceState: undefined })).toBe(
            levainNativeBankKey(createDefaultPatch().instrumentId)
        );
    });
});
