import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPluginParameter as setPluginParameterRepository } from '../../../repositories/pluginBridge/setPluginParameter';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
} from '../../../stores/externalPluginParameterStore';
import { setPluginParameter } from '../setPluginParameter';

vi.mock('../../../repositories/pluginBridge/setPluginParameter', () => ({
    setPluginParameter: vi.fn(),
}));

describe('setPluginParameter', () => {
    it('should delegate native plugin parameter updates to the Plugin repository boundary', async () => {
        await setPluginParameter({ instanceId: 'instance-1', paramId: 9, value: 0.25 });

        expect(setPluginParameterRepository).toHaveBeenCalledWith({
            instanceId: 'instance-1',
            paramId: 9,
            value: 0.25,
        });
    });

    describe('published snapshot', () => {
        const seed = (value: number) =>
            externalPluginParameterStore.set({
                byInstanceId: {
                    'instance-1': {
                        engineAttached: true,
                        parameters: [
                            {
                                id: 9,
                                name: 'Tone',
                                value,
                                defaultValue: 0.5,
                                minValue: 0,
                                maxValue: 1,
                                unit: '',
                                isAutomatable: true,
                            },
                        ],
                    },
                },
            });

        afterEach(() => {
            externalPluginParameterStore.set(defaultExternalPluginParameterState);
            vi.mocked(setPluginParameterRepository).mockReset();
        });

        it('patches the snapshot value once the bridge write resolves', async () => {
            seed(0.25);
            vi.mocked(setPluginParameterRepository).mockResolvedValueOnce(undefined);

            await setPluginParameter({ instanceId: 'instance-1', paramId: 9, value: 0.8 });

            expect(externalPluginParameterStore.value?.byInstanceId['instance-1']?.parameters[0]?.value).toBe(0.8);
        });

        it('leaves the snapshot untouched when the bridge write is rejected', async () => {
            seed(0.25);
            vi.mocked(setPluginParameterRepository).mockRejectedValueOnce(new Error('refused'));

            await expect(setPluginParameter({ instanceId: 'instance-1', paramId: 9, value: 0.8 })).rejects.toThrow(
                'refused'
            );

            expect(externalPluginParameterStore.value?.byInstanceId['instance-1']?.parameters[0]?.value).toBe(0.25);
        });

        it('does not create a snapshot for an instance it has never published', async () => {
            vi.mocked(setPluginParameterRepository).mockResolvedValueOnce(undefined);

            await setPluginParameter({ instanceId: 'instance-unknown', paramId: 9, value: 0.8 });

            expect(externalPluginParameterStore.value?.byInstanceId['instance-unknown']).toBeUndefined();
        });
    });
});
