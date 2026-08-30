import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPluginParameters } from '../../../repositories/pluginBridge/getPluginParameters';
import { type PluginParameter } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    writeExternalPluginParameterSnapshot,
} from '../../../stores/externalPluginParameterStore';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { refreshExternalPluginParameters } from '../refreshExternalPluginParameters';
import { toExternalPluginParameters } from '../toExternalPluginParameters';

vi.mock('../../../repositories/pluginBridge/getPluginParameters', () => ({
    getPluginParameters: vi.fn(),
}));

function pluginParameter(overrides: Partial<PluginParameter> & Pick<PluginParameter, 'id' | 'name'>): PluginParameter {
    return {
        value: 0,
        default_value: 0,
        min_value: 0,
        max_value: 1,
        unit: '',
        is_automatable: true,
        ...overrides,
    };
}

describe('refreshExternalPluginParameters', () => {
    beforeEach(() => {
        vi.mocked(getPluginParameters).mockReset();
        loadedExternalInstances.clear();
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('publishes the host parameter list, mapped onto the store contract', async () => {
        loadedExternalInstances.add('inst-1');
        writeExternalPluginParameterSnapshot('inst-1', { engineAttached: true, parameters: [] });
        vi.mocked(getPluginParameters).mockResolvedValue([
            pluginParameter({
                id: 12,
                name: 'Cutoff',
                value: 900,
                default_value: 1000,
                min_value: 20,
                max_value: 20000,
                unit: 'Hz',
            }),
            pluginParameter({ id: 13, name: 'Program', is_automatable: false }),
        ]);

        await refreshExternalPluginParameters('inst-1');

        expect(getPluginParameters).toHaveBeenCalledWith('inst-1');
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: true,
            parameters: [
                {
                    id: 12,
                    name: 'Cutoff',
                    value: 900,
                    defaultValue: 1000,
                    minValue: 20,
                    maxValue: 20000,
                    unit: 'Hz',
                    isAutomatable: true,
                },
                {
                    id: 13,
                    name: 'Program',
                    value: 0,
                    defaultValue: 0,
                    minValue: 0,
                    maxValue: 1,
                    unit: '',
                    isAutomatable: false,
                },
            ],
        });
    });

    it('preserves the attachment recorded at activation, which the host list cannot report', async () => {
        loadedExternalInstances.add('inst-detached');
        writeExternalPluginParameterSnapshot('inst-detached', { engineAttached: false, parameters: [] });
        vi.mocked(getPluginParameters).mockResolvedValue([pluginParameter({ id: 1, name: 'Drive' })]);

        await refreshExternalPluginParameters('inst-detached');

        expect(externalPluginParameterStore.value?.byInstanceId['inst-detached']?.engineAttached).toBe(false);
    });

    it('does not query the host for an instance that is not loaded', async () => {
        await refreshExternalPluginParameters('inst-gone');

        expect(getPluginParameters).not.toHaveBeenCalled();
        expect(externalPluginParameterStore.value?.byInstanceId['inst-gone']).toBeUndefined();
    });

    it('leaves the last known parameters standing when the host refuses the read', async () => {
        loadedExternalInstances.add('inst-1');
        writeExternalPluginParameterSnapshot('inst-1', {
            engineAttached: true,
            parameters: toExternalPluginParameters([pluginParameter({ id: 4, name: 'Mix' })]),
        });
        vi.mocked(getPluginParameters).mockRejectedValue(new Error('instance is gone'));

        await expect(refreshExternalPluginParameters('inst-1')).resolves.toBeUndefined();

        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters).toEqual([
            expect.objectContaining({ id: 4, name: 'Mix' }),
        ]);
    });
});
