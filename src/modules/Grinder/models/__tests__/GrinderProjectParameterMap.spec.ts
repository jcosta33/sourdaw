import { describe, expect, it } from 'vitest';

import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../GrinderPatch';
import { applyGrinderProjectParameters, GRINDER_PROJECT_PARAM_KEYS } from '../GrinderProjectParameterMap';

describe('Grinder project parameter projection', () => {
    it('contains every descriptor-backed control in the serialized patch contract', () => {
        const descriptorKeys = getAutomationDeviceDescriptor('grinder')?.parameters.map((parameter) => parameter.id);
        const serializedKeys = new Set<string>(GRINDER_PROJECT_PARAM_KEYS);

        expect(descriptorKeys?.every((key) => serializedKeys.has(key))).toBe(true);
        expect(new Set(GRINDER_PROJECT_PARAM_KEYS).size).toBe(GRINDER_PROJECT_PARAM_KEYS.length);
    });

    it('decodes stored values, restores absent defaults, and preserves session-only fields', () => {
        const projected = applyGrinderProjectParameters(
            {
                ...DEFAULT_PATCH,
                uiSection: 'lab',
                gain: 9,
                bright: true,
                engineMode: 'hybrid',
                gateEnabled: false,
                ampModel: 'clean-twin',
                routingMode: 'serial',
                limiterEnabled: true,
            },
            {
                gain: 2,
                bright: 0,
                engineMode: 1,
                gateEnabled: 1,
                ampModel: 4,
                routingMode: 3,
                limiterEnabled: 0,
            }
        );

        expect(projected).toMatchObject({
            uiSection: 'lab',
            gain: 2,
            bright: false,
            engineMode: 'capture',
            gateEnabled: true,
            ampModel: 'rectifier',
            routingMode: 'dual-amp',
            limiterEnabled: false,
            bass: DEFAULT_PATCH.bass,
        });

        expect(applyGrinderProjectParameters(projected, {})).toMatchObject({
            gateEnabled: DEFAULT_PATCH.gateEnabled,
            ampModel: DEFAULT_PATCH.ampModel,
            routingMode: DEFAULT_PATCH.routingMode,
            limiterEnabled: DEFAULT_PATCH.limiterEnabled,
        });
    });
});
