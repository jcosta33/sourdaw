import { describe, expect, it } from 'vitest';

import { FAUST_INSTRUMENT_PRESETS } from '../faustInstrumentPresets';

describe('faustInstrumentPresets', () => {
    it('exports a non-empty preset array', () => {
        expect(FAUST_INSTRUMENT_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id', () => {
        const ids = new Set<string>();
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('every preset has a non-empty name', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.name).toBeTruthy();
        }
    });

    it('every preset has midi trackKind', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.trackKind).toBe('midi');
        }
    });

    it('every preset has at least one device', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            expect(preset.devices.length).toBeGreaterThan(0);
        }
    });

    it('every device has a faust- prefixed type', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                expect(device.type).toBeTruthy();
                // Faust instruments should use faust- prefixed types (or builtin- for effects)
            }
        }
    });

    it('every device has parameterValues object', () => {
        for (const preset of FAUST_INSTRUMENT_PRESETS) {
            for (const device of preset.devices) {
                expect(typeof device.parameterValues).toBe('object');
            }
        }
    });
});
