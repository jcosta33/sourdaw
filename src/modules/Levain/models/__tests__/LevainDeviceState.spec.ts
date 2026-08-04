import { describe, expect, it } from 'vitest';

import { LEVAIN_DEVICE_STATE_VERSION, fromLevainDeviceState, toLevainDeviceState } from '../LevainDeviceState';
import { createDefaultPatch } from '../LevainPatch';

describe('toLevainDeviceState', () => {
    it('writes the two patch fields parameterValues cannot carry, under the chunk version', () => {
        const patch = { ...createDefaultPatch('cello'), currentArticulation: 'pizzicato' as const };

        expect(toLevainDeviceState(patch)).toEqual({
            version: LEVAIN_DEVICE_STATE_VERSION,
            data: { instrumentId: 'cello', currentArticulation: 'pizzicato' },
        });
    });
});

describe('fromLevainDeviceState', () => {
    it('reads back the instrument and articulation a live patch wrote', () => {
        const patch = { ...createDefaultPatch('horn'), currentArticulation: 'marcato' as const };

        expect(fromLevainDeviceState(toLevainDeviceState(patch))).toEqual({
            instrumentId: 'horn',
            currentArticulation: 'marcato',
        });
    });

    it('rejects a chunk written by a version this build does not know', () => {
        expect(
            fromLevainDeviceState({
                version: LEVAIN_DEVICE_STATE_VERSION + 1,
                data: { instrumentId: 'cello', currentArticulation: 'sustain' },
            })
        ).toBeNull();
    });

    it('rejects an instrument id that is not one of the instruments', () => {
        // The whole chunk goes, not just the id: with no instrument there is no
        // patch to hang the articulation on, and inventing violin-1 here would hide
        // the bad value behind the same default an unedited device gets.
        expect(
            fromLevainDeviceState({ version: LEVAIN_DEVICE_STATE_VERSION, data: { instrumentId: 'kazoo' } })
        ).toBeNull();
        expect(fromLevainDeviceState({ version: LEVAIN_DEVICE_STATE_VERSION, data: { instrumentId: 7 } })).toBeNull();
    });

    it('falls back to the instrument default for an articulation that instrument does not have', () => {
        // `pizzicato` is a real articulation and a nonsense one on a trumpet, whose
        // list has no entry for it — and the list is what the panel resolves the
        // display name from.
        const decoded = fromLevainDeviceState({
            version: LEVAIN_DEVICE_STATE_VERSION,
            data: { instrumentId: 'trumpet', currentArticulation: 'pizzicato' },
        });

        expect(decoded?.instrumentId).toBe('trumpet');
        expect(decoded?.currentArticulation).toBe(createDefaultPatch('trumpet').currentArticulation);
    });

    it('reads no identity out of an absent or malformed chunk', () => {
        expect(fromLevainDeviceState(undefined)).toBeNull();
        expect(fromLevainDeviceState({ version: LEVAIN_DEVICE_STATE_VERSION })).toBeNull();
        expect(fromLevainDeviceState('cello')).toBeNull();
    });
});
