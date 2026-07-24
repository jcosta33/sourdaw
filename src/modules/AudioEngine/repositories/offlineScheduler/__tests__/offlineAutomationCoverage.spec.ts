import { describe, it, expect, vi } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { resolveDeviceParamTargets } from '../../../services/deviceResolution';
import { createOfflineDeviceNode } from '../../deviceNodeFactory';
import { FaustDeviceStrategy } from '../../deviceStrategy/FaustDeviceStrategy';
import { NativeDspDeviceStrategy } from '../../deviceStrategy/NativeDspDeviceStrategy';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

/**
 * OE-3 class guard. Offline device-param automation used to resolve only via a
 * hardcoded param map plus three opt-in native nodes, so any other device
 * (notably every Faust plugin) rendered its parameter automation frozen. The
 * scheduler now asks each device through the single `resolveOfflineAutomation`
 * capability. These specs enumerate the device registry rather than a hand list
 * and assert every offline-automation backend answers that capability, so the
 * allow-list class cannot silently regrow.
 */
describe('offline device-param automation capability coverage', () => {
    it('surfaces every built-in Web Audio family’s automatable params through the capability, faithful to the offline map', () => {
        const context = asBaseAudioContext(createMockAudioContext());
        const covered: string[] = [];

        for (const descriptor of getBuiltinPlugins()) {
            const automatableParamIds = descriptor.parameters
                .filter((param) => param.automatable)
                .map((param) => param.id);
            if (automatableParamIds.length === 0) {
                continue;
            }

            // Native / Faust / instrument families are not built by the Web Audio
            // node factory; they are covered by their own backends below.
            let node;
            try {
                node = createOfflineDeviceNode({ context, deviceType: descriptor.id });
            } catch {
                continue;
            }
            if (!node) {
                continue;
            }

            const strategy = new WebAudioDeviceStrategy(node, descriptor.id);
            covered.push(descriptor.id);

            for (const parameterId of automatableParamIds) {
                const mapResolvesTarget = resolveDeviceParamTargets(descriptor.id, parameterId, node).length > 0;
                const binding = strategy.resolveOfflineAutomation(parameterId);
                // The capability is the sole resolution path: it answers a binding
                // exactly when the family exposes an AudioParam target, and never a
                // silent scheduler-side decision.
                expect(binding !== null).toBe(mapResolvesTarget);
                if (binding) {
                    expect(binding.kind).toBe('audioParam');
                }
            }

            node.dispose?.();
        }

        // The enumeration is live and reaches the core mapped families rather than
        // vacuously skipping everything.
        expect(covered).toEqual(
            expect.arrayContaining([
                'builtin-eq',
                'builtin-compressor',
                'builtin-delay',
                'builtin-filter',
                'builtin-gain',
            ])
        );
    });

    it('resolves a built-in Web Audio parameter to its real AudioParam target', () => {
        const context = asBaseAudioContext(createMockAudioContext());
        const node = createOfflineDeviceNode({ context, deviceType: 'builtin-filter' });
        if (!node) {
            throw new Error('expected a builtin-filter offline node');
        }
        const filterNode = node.namedNodes?.filter as unknown as { frequency: AudioParam } | undefined;
        if (!filterNode) {
            throw new Error('expected a named filter node');
        }
        const filterFrequency = filterNode.frequency;
        const strategy = new WebAudioDeviceStrategy(node, 'builtin-filter');

        const binding = strategy.resolveOfflineAutomation('filter-cutoff');

        expect(binding?.kind).toBe('audioParam');
        expect(binding?.kind === 'audioParam' && binding.targets[0]?.audioParam).toBe(filterFrequency);
        expect(strategy.resolveOfflineAutomation('not-a-parameter')).toBeNull();
    });

    it('lets a native DSP worklet answer the capability with frame-addressed segments', () => {
        const scheduleParam = vi.fn();
        const strategy = new NativeDspDeviceStrategy({
            workletNode: {} as AudioWorkletNode,
            ready: Promise.resolve({}),
            acceptsScheduledParam: (name) => name === 'mix',
            scheduleParam,
        });
        const segments = [{ startFrame: 0, endFrame: 128, startValue: 0.2, endValue: 0.8 }];

        const binding = strategy.resolveOfflineAutomation('mix');
        expect(binding?.kind).toBe('segments');
        if (binding?.kind === 'segments') {
            binding.apply(segments);
        }

        expect(scheduleParam).toHaveBeenCalledWith('mix', segments);
        expect(strategy.resolveOfflineAutomation('unsupported')).toBeNull();
    });

    it('lets a Faust device answer the capability through its AudioParam map', () => {
        const cutoff = { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
        const faustNode = {
            setParamValue: vi.fn(),
            parameters: new Map([['/dsp/cutoff', cutoff]]),
        } as unknown as ConstructorParameters<typeof FaustDeviceStrategy>[1];
        const strategy = new FaustDeviceStrategy(
            { inputNode: {} as AudioNode, outputNode: {} as AudioNode, nodes: [faustNode] },
            faustNode
        );

        const binding = strategy.resolveOfflineAutomation('cutoff');

        expect(binding?.kind).toBe('audioParam');
        expect(binding?.kind === 'audioParam' && binding.targets[0]?.audioParam).toBe(cutoff);
        expect(strategy.resolveOfflineAutomation('missing')).toBeNull();
    });
});
