import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Device } from '../../models/TrackViewTypes';
import { UnsupportedDeviceTypeError } from '../../repositories/deviceStrategy/unsupportedDeviceTypeError';
import { buildDeviceChain } from '../buildDeviceChain';

import type { AudioDeviceStrategy } from '../../repositories/deviceStrategy/setupDeviceStrategies';

/**
 * A refusal thrown out of the middle of a rack is the one chain exit
 * `destroyOfflineDeviceStrategies` cannot cover: the entries built before it
 * never reach the caller, so nothing else holds a handle to them. Every metered
 * native device took one of the shared 64 telemetry slots at construction and
 * only its `destroy()` gives the slot back, so a refusal that walks past the
 * earlier entries kills gain-reduction, LUFS, tuner and gate meters for every
 * device added later in the page session.
 *
 * The device registry is stubbed here because the subject is what the chain
 * does with the strategies it built, not which factory built them.
 */

const { mocks } = vi.hoisted(() => ({
    mocks: {
        createDevice: vi.fn<(ctx: BaseAudioContext, device: Device) => Promise<AudioDeviceStrategy>>(),
        destroy: vi.fn(),
        loggerWarn: vi.fn(),
        readAttachedEngineInstanceIds: vi.fn<() => ReadonlySet<string>>(() => new Set()),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: vi.fn(() => false),
    isFaustInstrumentModule: vi.fn(() => false),
}));

vi.mock('../../repositories/deviceStrategy/setupDeviceStrategies', () => ({
    createDeviceRegistry: () => ({ createDevice: mocks.createDevice }),
}));

vi.mock('../livePlayback/readAttachedEngineInstanceIds', () => ({
    readAttachedEngineInstanceIds: mocks.readAttachedEngineInstanceIds,
}));

function audioNode(): AudioNode {
    return { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 1 } as unknown as AudioNode;
}

/** A device that builds, holds a telemetry slot, and reports its teardown. */
function meteredStrategy(): AudioDeviceStrategy {
    return {
        node: { inputNode: audioNode(), outputNode: audioNode(), nodes: [] },
        acceptsNotes: false,
        setParam: vi.fn(),
        resolveOfflineAutomation: () => null,
        destroy: mocks.destroy,
    };
}

describe('buildDeviceChain — teardown when a refusal aborts the rack', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        // Reset rather than clear: one test installs a throwing `destroy`.
        vi.resetAllMocks();
        vi.stubGlobal('AudioWorkletNode', undefined);
        mocks.readAttachedEngineInstanceIds.mockReturnValue(new Set(['inst-1']));
        mocks.createDevice.mockImplementation((_ctx, device) => {
            if (device.type === 'external-plugin') {
                return Promise.reject(
                    new UnsupportedDeviceTypeError(device.type, 'the native engine hosts this device')
                );
            }
            return Promise.resolve(meteredStrategy());
        });
    });

    it('destroys the strategies already built in the rack before the refusal throws', async () => {
        const input = audioNode();
        const output = audioNode();
        const devices: Device[] = [
            { id: 'd-comp', name: 'Gluten', type: 'gluten', bypassed: false, parameterValues: {} },
            {
                id: 'd-plugin',
                name: 'Analog EQ',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalInstanceId: 'inst-1',
            },
        ];

        const failure = await buildDeviceChain({} as BaseAudioContext, devices, input, output, {
            trackName: 'Guitar',
        }).catch((error: unknown) => error);

        expect(failure).toMatchObject({ _tag: 'Export' });
        expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it('still refuses when the built device throws on the way out', async () => {
        mocks.destroy.mockImplementation(() => {
            throw new Error('slot already released');
        });
        const input = audioNode();
        const output = audioNode();
        const devices: Device[] = [
            { id: 'd-comp', name: 'Gluten', type: 'gluten', bypassed: false, parameterValues: {} },
            {
                id: 'd-plugin',
                name: 'Analog EQ',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalInstanceId: 'inst-1',
            },
        ];

        const failure = await buildDeviceChain({} as BaseAudioContext, devices, input, output, {
            trackName: 'Guitar',
        }).catch((error: unknown) => error);

        // The teardown fault must not replace the sentence the user has to act on.
        expect(failure).toMatchObject({ _tag: 'Export' });
        expect((failure as Error).message).toContain('Bypass or remove the plugin');
        expect(mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('slot already released'));
    });
});
