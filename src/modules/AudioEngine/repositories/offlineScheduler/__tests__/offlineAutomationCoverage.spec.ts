import { describe, it, expect, vi } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { FERMENTER_AUTOMATION_PARAM_IDS, isFermenterDevice } from '../../../engine/FermenterNode';
import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS, isProofChamberDevice } from '../../../engine/ProofChamberNode';
import { TOASTER_AUTOMATION_PARAM_IDS, isToasterDevice } from '../../../engine/ToasterNode';
import { resolveDeviceParamTargets } from '../../../services/deviceResolution';
import { createOfflineDeviceNode } from '../../deviceNodeFactory';
import { FaustDeviceStrategy } from '../../deviceStrategy/FaustDeviceStrategy';
import { NativeDspDeviceStrategy } from '../../deviceStrategy/NativeDspDeviceStrategy';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

function makeAudioParamStub() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}

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

    it('resolves every capable native DSP family’s automatable params exactly to its real scheduled-param wiring', () => {
        // Real acceptsScheduledParam wiring per capable native worklet, sourced
        // from the node modules rather than fabricated here.
        const nativeScheduledParams: Array<{
            accepts: (type: string) => boolean;
            params: Readonly<Record<string, number>>;
        }> = [
            { accepts: isFermenterDevice, params: FERMENTER_AUTOMATION_PARAM_IDS },
            { accepts: isToasterDevice, params: TOASTER_AUTOMATION_PARAM_IDS },
            { accepts: isProofChamberDevice, params: PROOF_CHAMBER_AUTOMATION_PARAM_IDS },
        ];
        let coveredFamilies = 0;
        let coveredResolvable = 0;

        for (const descriptor of getBuiltinPlugins()) {
            const scheduled = nativeScheduledParams.find((entry) => entry.accepts(descriptor.id))?.params;
            if (!scheduled) {
                continue;
            }
            const automatableParamIds = descriptor.parameters
                .filter((param) => param.automatable)
                .map((param) => param.id);
            if (automatableParamIds.length === 0) {
                continue;
            }

            // The real strategy over a fake node carrying the family's actual
            // acceptsScheduledParam predicate (its real offline param-id map).
            const strategy = new NativeDspDeviceStrategy({
                workletNode: {} as AudioWorkletNode,
                ready: Promise.resolve({}),
                acceptsScheduledParam: (name: string) => Object.hasOwn(scheduled, name),
                scheduleParam: vi.fn(),
            });
            coveredFamilies += 1;

            for (const parameterId of automatableParamIds) {
                const binding = strategy.resolveOfflineAutomation(parameterId);
                expect(binding !== null).toBe(Object.hasOwn(scheduled, parameterId));
                if (binding) {
                    expect(binding.kind).toBe('segments');
                    coveredResolvable += 1;
                }
            }
        }

        // Every native family that accepts offline automation (Fermenter,
        // Toaster, ProofChamber) resolved its real scheduled params through the
        // one capability, driven from the registry rather than a hand list.
        expect(coveredFamilies).toBeGreaterThan(1);
        expect(coveredResolvable).toBeGreaterThan(0);
    });

    it('resolves every Faust family’s automatable params through its AudioParam map', () => {
        let coveredFamilies = 0;
        let coveredParams = 0;

        for (const descriptor of getBuiltinPlugins()) {
            // Faust module ids carry the `faust-` prefix; isFaustModule keys off a
            // runtime compile registry, so classify structurally from the registry.
            if (!descriptor.id.startsWith('faust-')) {
                continue;
            }
            const automatableParamIds = descriptor.parameters
                .filter((param) => param.automatable)
                .map((param) => param.id);
            if (automatableParamIds.length === 0) {
                continue;
            }

            // A Faust worklet exposes each param as an AudioParam keyed by its full
            // address; the strategy's bare-name cache maps the lane parameterId to it.
            const params = new Map(
                automatableParamIds.map((paramId) => [`/${descriptor.id}/${paramId}`, makeAudioParamStub()] as const)
            );
            const faustNode = {
                setParamValue: vi.fn(),
                parameters: params,
            } as unknown as ConstructorParameters<typeof FaustDeviceStrategy>[1];
            const strategy = new FaustDeviceStrategy(
                { inputNode: {} as AudioNode, outputNode: {} as AudioNode, nodes: [faustNode] },
                faustNode,
                false,
                48_000
            );
            coveredFamilies += 1;

            for (const parameterId of automatableParamIds) {
                const binding = strategy.resolveOfflineAutomation(parameterId);
                expect(binding?.kind).toBe('audioParam');
                expect(binding?.kind === 'audioParam' && binding.targets[0]?.audioParam).toBe(
                    params.get(`/${descriptor.id}/${parameterId}`)
                );
                coveredParams += 1;
            }
            // A param the Faust node does not expose stays null.
            expect(strategy.resolveOfflineAutomation('__absent__')).toBeNull();
        }

        expect(coveredFamilies).toBeGreaterThan(0);
        expect(coveredParams).toBeGreaterThan(0);
    });
});
