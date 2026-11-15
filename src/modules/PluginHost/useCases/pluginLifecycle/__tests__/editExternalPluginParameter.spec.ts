import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPluginParameter } from '../../../repositories/pluginBridge/setPluginParameter';
import {
    defaultExternalPluginParameterState,
    dropExternalPluginParameterSnapshot,
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

type ControlledSend = {
    value: number;
    resolve: () => void;
    reject: (error: Error) => void;
};

/** Make every host send wait until the test settles it, recording the value it carried. */
function controlSends(): ControlledSend[] {
    const sends: ControlledSend[] = [];
    vi.mocked(setPluginParameter).mockImplementation(
        (input) =>
            new Promise<void>((resolve, reject) => {
                sends.push({ value: input.value, resolve, reject });
            })
    );
    return sends;
}

const request = (value: number): Promise<void> =>
    editExternalPluginParameter({ instanceId: INSTANCE, parameterId: 12, value });

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
        await request(4);

        expect(setPluginParameter).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE, paramId: 12, value: 1 });
        expect(valueOf()).toBe(1);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 1 }]);
    });

    it('sends the range minimum for a value below it', async () => {
        await request(-3);

        expect(setPluginParameter).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE, paramId: 12, value: 0 });
        expect(valueOf()).toBe(0);
    });

    it('patches nothing and notifies nobody when the host refuses', async () => {
        vi.mocked(setPluginParameter).mockRejectedValue(new Error('refused'));

        await expect(request(0.5)).rejects.toThrow('refused');

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

    it('holds a second request until the first send settles and sends only the newest pending value', async () => {
        const sends = controlSends();

        const first = request(0.2);
        const second = request(0.4);
        const third = request(0.6);
        expect(sends.map((send) => send.value)).toEqual([0.2]);

        sends[0]?.resolve();
        await first;
        await vi.waitFor(() => expect(sends.map((send) => send.value)).toEqual([0.2, 0.6]));
        sends[1]?.resolve();
        await Promise.all([second, third]);

        expect(setPluginParameter).toHaveBeenCalledTimes(2);
        expect(valueOf()).toBe(0.6);
        expect(edits.map((edit) => edit.value)).toEqual([0.2, 0.6]);
    });

    it('settles a replaced request with the outcome of the send that replaced it', async () => {
        const sends = controlSends();

        const first = request(0.2);
        const replaced = request(0.4);
        const newest = request(0.6);
        sends[0]?.resolve();
        await first;
        await vi.waitFor(() => expect(sends).toHaveLength(2));
        sends[1]?.reject(new Error('refused'));

        await expect(replaced).rejects.toThrow('refused');
        await expect(newest).rejects.toThrow('refused');
    });

    it('publishes the older value once when the older send is accepted and the newer one is refused', async () => {
        const sends = controlSends();

        const older = request(0.3);
        const newer = request(0.8);
        sends[0]?.resolve();
        await older;
        await vi.waitFor(() => expect(sends).toHaveLength(2));
        sends[1]?.reject(new Error('refused'));
        await expect(newer).rejects.toThrow('refused');

        expect(valueOf()).toBe(0.3);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.3 }]);
    });

    it('keeps a plugin-originated edit that published while a host send was in flight', async () => {
        const sends = controlSends();

        const inFlight = request(0.9);
        publishExternalPluginParameterEdit({ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 });
        sends[0]?.resolve();
        await inFlight;

        expect(valueOf()).toBe(0.4);
        expect(edits).toEqual([{ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 }]);
    });

    it('sends and publishes a request made after a plugin-originated edit', async () => {
        const sends = controlSends();
        const inFlight = request(0.9);
        publishExternalPluginParameterEdit({ instanceId: INSTANCE, parameterId: 12, kind: 'value', value: 0.4 });
        sends[0]?.resolve();
        await inFlight;

        const after = request(0.7);
        await vi.waitFor(() => expect(sends).toHaveLength(2));
        sends[1]?.resolve();
        await after;

        expect(valueOf()).toBe(0.7);
        expect(edits.map((edit) => edit.value)).toEqual([0.4, 0.7]);
    });

    it('drops a pending value, without sending it, when its parameter is gone by the time it would be sent', async () => {
        const sends = controlSends();

        const first = request(0.2);
        const pending = request(0.5);
        dropExternalPluginParameterSnapshot(INSTANCE);
        sends[0]?.resolve();
        await first;

        await expect(pending).rejects.toBeInstanceOf(Error);
        expect(sends.map((send) => send.value)).toEqual([0.2]);
    });
});
