/**
 * What a device says once it is addressed to the native engine (#3893).
 *
 * The engine resolves every key of a device's `parameterValues` against the
 * built-in's own vocabulary and refuses the whole batch over one it cannot
 * name, so a Fermenter chain sent in the ids a panel authors takes down every
 * strip travelling with it. The cases below therefore read the record that
 * reaches the wire, not the record the project holds.
 *
 * The projector is pure, so nothing is mocked.
 */

import { describe, expect, it } from 'vitest';

import { type Device } from '#/modules/Arrangement/stores';

import { projectDeviceForNativeBody } from '../projectDeviceForNativeBody';

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

describe('projectDeviceForNativeBody', () => {
    // The two vocabularies differ on both halves of the mapping: an override
    // renames the parameter outright, and everything else is the same word
    // respelled. A projector that did only one of them would still red here.
    it('spells a fermenter chain in the names the instrument answers to', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({
                id: 'device-a',
                type: 'fermenter',
                parameterValues: { oscEngine: 2, filterCutoff: 800, oscLevel: 0.5 },
            })
        );

        expect(projected.parameterValues).toEqual({ engine: 2, cutoff: 800, osc_level: 0.5 });
    });

    it('leaves everything but the parameters of a projected device alone', () => {
        const device = createDevice({ id: 'device-a', type: 'fermenter', bypassed: true, name: 'Lead' });

        expect(projectDeviceForNativeBody(device)).toEqual({ ...device, parameterValues: {} });
    });

    // `knead` already names its parameters the way the engine does, so the
    // record it sends has to be the record the project holds.
    it('carries a knead chain through in the names the project already stores', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'knead', parameterValues: { shift_semitones: 3 } })
        );

        expect(projected.parameterValues).toEqual({ shift_semitones: 3 });
    });

    // The engine case-folds a device type, so the renderer has to admit the
    // same spellings or a display-cased chain silently keeps its panel ids.
    it('projects a device whose type is spelled as a display name', () => {
        const projected = projectDeviceForNativeBody(
            createDevice({ id: 'device-a', type: 'Fermenter', parameterValues: { oscEngine: 1 } })
        );

        expect(projected.parameterValues).toEqual({ engine: 1 });
    });

    // A hosted plugin's parameters are the plugin's own and the renderer holds
    // no vocabulary for them, so the projector must not so much as copy the
    // device: an identity check is what proves it never reached the record.
    it('returns a hosted plugin device exactly as it stands', () => {
        const device = createDevice({
            id: 'device-a',
            name: 'Pro-Q',
            type: 'plugin',
            externalPluginId: 'clap:com.example.eq',
            externalInstanceId: 'inst-1',
            parameterValues: { oscEngine: 2 },
        });

        expect(projectDeviceForNativeBody(device)).toBe(device);
    });

    it('returns a device of a type the engine builds no body for exactly as it stands', () => {
        const device = createDevice({ id: 'device-a', type: 'builtin-eq', parameterValues: { oscEngine: 2 } });

        expect(projectDeviceForNativeBody(device)).toBe(device);
    });
});
