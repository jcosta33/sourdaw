import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPluginParameter } from '../../../repositories/pluginBridge/setPluginParameter';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    writeExternalPluginParameterSnapshot,
} from '../../../stores/externalPluginParameterStore';
import { editExternalPluginParameter } from '../editExternalPluginParameter';
import { type ExternalPluginParameterEdit } from '../externalPluginParameterEditObservers';
import { observeExternalPluginParameterEdits } from '../observeExternalPluginParameterEdits';
import { publishExternalPluginParameterEdit } from '../publishExternalPluginParameterEdit';

vi.mock('../../../repositories/pluginBridge/setPluginParameter', () => ({
    setPluginParameter: vi.fn(),
}));
vi.mock('../../../repositories/pluginBridge/onPluginParameterEvents', () => ({
    onPluginParameterEvents: vi.fn(() => Promise.resolve(() => {})),
}));

const INSTANCE = 'inst-1';

function seed(): void {
    writeExternalPluginParameterSnapshot(INSTANCE, {
        engineAttached: true,
        parameters: [
            {
                id: 12,
                name: 'Cutoff',
                value: 0.1,
                defaultValue: 0.1,
                minValue: 0,
                maxValue: 1,
                unit: '',
                isAutomatable: true,
            },
        ],
    });
}

function valueOf(): number | undefined {
    return externalPluginParameterStore.value?.byInstanceId[INSTANCE]?.parameters.find(
        (parameter) => parameter.id === 12
    )?.value;
}

describe('editExternalPluginParameter', () => {
    const edits: ExternalPluginParameterEdit[] = [];
    let stop = (): void => {};

    beforeEach(() => {
        vi.mocked(setPluginParameter).mockReset();
        vi.mocked(setPluginParameter).mockResolvedValue();
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
        seed();
        edits.length = 0;
        stop();
        stop = observeExternalPluginParameterEdits((edit) => {
            edits.push(edit);
        });
    });

    it('sends the clamped value, patches the snapshot and notifies observers with a value edit', async () => {
        await editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 4 });

        expect(setPluginParameter).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE, paramId: 12, value: 1 });
        expect(valueOf()).toBe(1);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 1 }]);
    });

    it('patches nothing and notifies nobody when the host refuses', async () => {
        vi.mocked(setPluginParameter).mockRejectedValue(new Error('refused'));

        await expect(
            editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.5 })
        ).rejects.toThrow('refused');

        expect(valueOf()).toBe(0.1);
        expect(edits).toEqual([]);
    });

    it.each([
        ['an unknown instance', { instanceId: 'nope', parameterId: 12, value: 0.5 }],
        ['an unknown parameter', { instanceId: INSTANCE, parameterId: 99, value: 0.5 }],
        ['a NaN value', { instanceId: INSTANCE, parameterId: 12, value: Number.NaN }],
        ['an infinite value', { instanceId: INSTANCE, parameterId: 12, value: Number.POSITIVE_INFINITY }],
    ])('refuses %s without reaching the host', async (_name, input) => {
        await expect(editExternalPluginParameter(input)).rejects.toBeInstanceOf(Error);

        expect(setPluginParameter).not.toHaveBeenCalled();
        expect(valueOf()).toBe(0.1);
        expect(edits).toEqual([]);
    });

    it('lets the newer value win when an older send settles last', async () => {
        const settle: Array<() => void> = [];
        vi.mocked(setPluginParameter).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    settle.push(resolve);
                })
        );

        const older = editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.3 });
        const newer = editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.8 });
        settle[1]?.();
        await newer;
        settle[0]?.();
        await older;

        expect(valueOf()).toBe(0.8);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.8 }]);
    });

    it('publishes the older value once when the older send is accepted and the newer one is refused', async () => {
        const settle: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
        vi.mocked(setPluginParameter).mockImplementation(
            () =>
                new Promise<void>((resolve, reject) => {
                    settle.push({ resolve, reject });
                })
        );

        const older = editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.3 });
        const newer = editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.8 });
        settle[0]?.resolve();
        await older;
        settle[1]?.reject(new Error('refused'));
        await expect(newer).rejects.toThrow('refused');

        expect(valueOf()).toBe(0.3);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.3 }]);
    });

    it('publishes both sends in order when each is accepted in the order it started', async () => {
        await editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.3 });
        await editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.8 });

        expect(valueOf()).toBe(0.8);
        expect(edits.map((edit) => edit.value)).toEqual([0.3, 0.8]);
    });

    it('keeps a plugin-originated edit that published while a host send was in flight', async () => {
        let settle = (): void => {};
        vi.mocked(setPluginParameter).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    settle = resolve;
                })
        );

        const send = editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.9 });
        publishExternalPluginParameterEdit({ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 });
        settle();
        await send;

        expect(valueOf()).toBe(0.4);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 }]);
    });

    it('publishes a host send that started after a plugin-originated edit', async () => {
        publishExternalPluginParameterEdit({ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 });

        await editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value: 0.9 });

        expect(valueOf()).toBe(0.9);
        expect(edits.map((edit) => edit.value)).toEqual([0.4, 0.9]);
    });
});
