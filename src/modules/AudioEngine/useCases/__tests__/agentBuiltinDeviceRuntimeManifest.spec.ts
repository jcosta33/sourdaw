import { describe, expect, it } from 'vitest';

import { findReleasedWasmDescriptor } from '../../engine/wasmDeviceRegistry';
import { getBuiltinDeviceRuntimeVersion } from '../../models/BuiltinDeviceRuntime';
import { BUILTIN_DEVICE_NODE_FACTORIES } from '../../repositories/deviceNodeFactory';
import { NATIVE_DSP_DEVICE_FACTORIES } from '../../repositories/deviceStrategy/nativeDspDeviceFactories';
import { getAgentBuiltinDeviceRuntimeManifest } from '../getAgentBuiltinDeviceRuntimeManifest';

describe('built-in device runtime manifest', () => {
    it('publishes the Grand Boule runtime', () => {
        expect(getAgentBuiltinDeviceRuntimeManifest(['grand-boule'])).toHaveLength(1);
    });

    it('projects physical factory topology, note support, and reported latency semantics', () => {
        const runtimeByType = new Map(
            getAgentBuiltinDeviceRuntimeManifest([
                'fermenter',
                'toaster',
                'gluten',
                'builtin-sidechain-compressor',
                'dutch-oven',
                'crust',
            ]).map((runtime) => [runtime.type, runtime])
        );

        expect(runtimeByType.get('fermenter')).toMatchObject({
            live: {
                ports: { inputs: 0, outputs: 1, externalInputs: 0 },
                notes: { availability: 'supported' },
                latency: { kind: 'pdc-default-zero' },
            },
            capabilities: {
                liveNode: { availability: 'available' },
                noteAcceptance: { availability: 'supported' },
                sidechainRouting: { availability: 'not-applicable' },
                offlineRender: { availability: 'available' },
            },
        });
        expect(runtimeByType.get('toaster')).toMatchObject({
            live: {
                ports: { inputs: 0, outputs: 17, externalInputs: 0 },
                notes: { availability: 'supported' },
            },
        });
        expect(runtimeByType.get('gluten')).toMatchObject({
            live: {
                ports: { inputs: 2, outputs: 1, externalInputs: 1, sidechainRouting: 'unavailable' },
                notes: { availability: 'unavailable' },
                latency: { kind: 'reported-dynamically' },
            },
            capabilities: {
                noteAcceptance: { availability: 'unavailable' },
                sidechainRouting: { availability: 'unavailable' },
            },
        });
        expect(runtimeByType.get('builtin-sidechain-compressor')).toMatchObject({
            live: {
                ports: { inputs: 2, outputs: 1, externalInputs: 1, sidechainRouting: 'available' },
                latency: { kind: 'fixed-samples', samples: 128 },
            },
            offline: { availability: 'conditional' },
            capabilities: {
                liveNode: { availability: 'available' },
                sidechainRouting: { availability: 'available' },
                offlineRender: { availability: 'conditional' },
            },
        });
        expect(runtimeByType.get('dutch-oven')).toMatchObject({
            live: { latency: { kind: 'reported-when-ready' } },
        });
        expect(runtimeByType.get('crust')).toMatchObject({
            live: { latency: { kind: 'reported-dynamically' } },
        });
    });

    it('welds every published runtime component to its live and offline factories', () => {
        for (const runtime of getAgentBuiltinDeviceRuntimeManifest()) {
            expect(runtime.capabilities.noteAcceptance).toBe(runtime.live.notes);
            expect(runtime.capabilities.offlineRender).toBe(runtime.offline);
            if (runtime.live.source === 'AudioEngine.deviceNodeFactory') {
                expect(
                    BUILTIN_DEVICE_NODE_FACTORIES.find((factory) => factory.type === runtime.type)?.runtime.live
                ).toBe(runtime.live);
            } else {
                expect(findReleasedWasmDescriptor(runtime.type)?.runtime).toBe(runtime.live);
            }

            if (runtime.offline.source === 'AudioEngine.deviceNodeFactory') {
                expect(
                    BUILTIN_DEVICE_NODE_FACTORIES.find((factory) => factory.type === runtime.type)?.runtime.offline
                ).toBe(runtime.offline);
            } else {
                expect(NATIVE_DSP_DEVICE_FACTORIES.find((factory) => factory.matches(runtime.type))?.runtime).toBe(
                    runtime.offline
                );
            }
        }
    });

    it('includes projected runtime capability identity in the runtime fingerprint', () => {
        const runtime = getAgentBuiltinDeviceRuntimeManifest(['builtin-sidechain-compressor'])[0];
        if (!runtime) {
            throw new Error('Expected sidechain compressor runtime component');
        }
        const { runtimeVersion, ...runtimeContract } = runtime;
        const mutatedCapabilities = {
            ...runtimeContract,
            capabilities: {
                ...runtimeContract.capabilities,
                sidechainRouting: { availability: 'unavailable' as const },
            },
        };

        expect(runtimeVersion).toBe(getBuiltinDeviceRuntimeVersion(runtimeContract));
        expect(runtimeVersion).not.toBe(getBuiltinDeviceRuntimeVersion(mutatedCapabilities));
    });
});
