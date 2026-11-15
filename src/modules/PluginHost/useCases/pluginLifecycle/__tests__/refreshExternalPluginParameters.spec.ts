import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readLastAutomationWriteSequence } from '#/modules/Transport/stores';

import { getPluginParameters } from '../../../repositories/pluginBridge/getPluginParameters';
import { type PluginParameter } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    patchExternalPluginParameterValue,
    readExternalPluginParameterReadIssue,
    writeExternalPluginParameterSnapshot,
} from '../../../stores/externalPluginParameterStore';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { refreshExternalPluginParameters } from '../refreshExternalPluginParameters';
import { toExternalPluginParameters } from '../toExternalPluginParameters';

vi.mock('../../../repositories/pluginBridge/getPluginParameters', () => ({
    getPluginParameters: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', () => ({
    readLastAutomationWriteSequence: vi.fn<() => number>(),
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
        vi.mocked(readLastAutomationWriteSequence).mockReset();
        vi.mocked(readLastAutomationWriteSequence).mockReturnValue(0);
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

        await expect(refreshExternalPluginParameters('inst-1')).resolves.toEqual([]);

        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters).toEqual([
            expect.objectContaining({ id: 4, name: 'Mix' }),
        ]);
    });

    describe('against newer facts', () => {
        const deferredRead = (): { resolve: (parameters: PluginParameter[]) => void } => {
            let resolve: (parameters: PluginParameter[]) => void = () => {};
            vi.mocked(getPluginParameters).mockImplementationOnce(
                () =>
                    new Promise<PluginParameter[]>((settle) => {
                        resolve = settle;
                    })
            );
            return { resolve: (parameters) => resolve(parameters) };
        };

        const seedLoaded = (): void => {
            loadedExternalInstances.add('inst-1');
            writeExternalPluginParameterSnapshot('inst-1', {
                engineAttached: true,
                parameters: toExternalPluginParameters([
                    pluginParameter({ id: 1, name: 'Decay', value: 0.1 }),
                    pluginParameter({ id: 2, name: 'Mix', value: 0.1 }),
                ]),
            });
        };

        const storedValue = (parameterId: number): number | undefined =>
            externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters.find(
                (parameter) => parameter.id === parameterId
            )?.value;

        it('keeps a value edited while the host was answering and takes the host value for the rest', async () => {
            seedLoaded();
            const read = deferredRead();
            const pending = refreshExternalPluginParameters('inst-1');

            patchExternalPluginParameterValue('inst-1', 1, 0.3);
            read.resolve([
                pluginParameter({ id: 1, name: 'Decay', value: 0.5 }),
                pluginParameter({ id: 2, name: 'Mix', value: 0.6 }),
            ]);
            const published = await pending;

            expect(storedValue(1)).toBe(0.3);
            expect(storedValue(2)).toBe(0.6);
            expect(published).toEqual([expect.objectContaining({ id: 2, value: 0.6 })]);
        });

        it('does not publish an older re-read that resolves after a newer one', async () => {
            seedLoaded();
            const older = deferredRead();
            const olderPending = refreshExternalPluginParameters('inst-1');
            const newer = deferredRead();
            const newerPending = refreshExternalPluginParameters('inst-1');

            newer.resolve([pluginParameter({ id: 1, name: 'Decay', value: 0.7 })]);
            const newerPublished = await newerPending;
            older.resolve([pluginParameter({ id: 1, name: 'Decay', value: 0.2 })]);
            const olderPublished = await olderPending;

            expect(olderPublished).toEqual([]);
            expect(newerPublished).toEqual([expect.objectContaining({ id: 1, value: 0.7 })]);
            expect(storedValue(1)).toBe(0.7);
        });

        it('publishes an answer whose newer re-read then fails', async () => {
            seedLoaded();
            const older = deferredRead();
            const olderPending = refreshExternalPluginParameters('inst-1');
            vi.mocked(getPluginParameters).mockRejectedValueOnce(new Error('instance is gone'));
            const newerPending = refreshExternalPluginParameters('inst-1');

            older.resolve([pluginParameter({ id: 1, name: 'Decay', value: 0.6 })]);
            const olderPublished = await olderPending;
            await newerPending;

            expect(olderPublished).toEqual([expect.objectContaining({ id: 1, value: 0.6 })]);
            expect(storedValue(1)).toBe(0.6);
        });

        it('keeps an edit made while a re-read was in flight when that re-read then fails', async () => {
            seedLoaded();
            vi.mocked(getPluginParameters).mockRejectedValueOnce(new Error('instance is gone'));
            const pending = refreshExternalPluginParameters('inst-1');

            patchExternalPluginParameterValue('inst-1', 1, 0.3);
            await pending;

            expect(storedValue(1)).toBe(0.3);
        });

        it('tags each published object with the scheduler write that was latest when the read was issued', async () => {
            seedLoaded();
            vi.mocked(readLastAutomationWriteSequence).mockReturnValue(5);
            const read = deferredRead();
            const pending = refreshExternalPluginParameters('inst-1');

            vi.mocked(readLastAutomationWriteSequence).mockReturnValue(9);
            patchExternalPluginParameterValue('inst-1', 1, 0.3);
            read.resolve([
                pluginParameter({ id: 1, name: 'Decay', value: 0.5 }),
                pluginParameter({ id: 2, name: 'Mix', value: 0.6 }),
            ]);
            const published = await pending;

            const stored = externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters ?? [];
            const [edited, republished] = stored;
            expect(published).toEqual([republished]);
            expect(republished && readExternalPluginParameterReadIssue(republished)).toBe(5);
            expect(edited && readExternalPluginParameterReadIssue(edited)).toBeUndefined();
        });

        it('publishes and returns nothing when the host refuses the read', async () => {
            seedLoaded();
            vi.mocked(getPluginParameters).mockRejectedValueOnce(new Error('instance is gone'));

            await expect(refreshExternalPluginParameters('inst-1')).resolves.toEqual([]);

            expect(storedValue(1)).toBe(0.1);
        });

        it('returns exactly the objects it put in the store', async () => {
            seedLoaded();
            vi.mocked(getPluginParameters).mockResolvedValueOnce([
                pluginParameter({ id: 1, name: 'Decay', value: 0.4 }),
                pluginParameter({ id: 2, name: 'Mix', value: 0.5 }),
            ]);

            const published = await refreshExternalPluginParameters('inst-1');

            expect(published).toHaveLength(2);
            expect(published).toEqual(externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters);
            published.forEach((parameter, index) => {
                expect(externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters[index]).toBe(parameter);
            });
        });
    });
});
