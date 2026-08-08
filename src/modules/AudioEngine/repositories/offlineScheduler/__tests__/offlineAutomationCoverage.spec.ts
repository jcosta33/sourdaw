import { describe, it, expect, vi } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { FERMENTER_AUTOMATION_PARAM_IDS, isFermenterDevice } from '../../../engine/FermenterNode';
import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS, isProofChamberDevice } from '../../../engine/ProofChamberNode';
import { TOASTER_AUTOMATION_PARAM_IDS, isToasterDevice } from '../../../engine/ToasterNode';
import { resolveDeviceParamTargets } from '../../../services/deviceResolution';
import { createOfflineDeviceNode } from '../../deviceNodeFactory';
import { FaustDeviceStrategy } from '../../deviceStrategy/FaustDeviceStrategy';
import { NATIVE_DSP_DEVICE_FACTORIES } from '../../deviceStrategy/nativeDspDeviceFactories';
import { NativeDspDeviceStrategy } from '../../deviceStrategy/NativeDspDeviceStrategy';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import {
    DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS,
    NO_DESCRIPTOR_NATIVE_DEVICE_TYPES,
    PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS,
} from './offlineAutomationExemptions';

function makeAudioParamStub() {
    return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}

/**
 * The nodes that supply a `scheduleParam`/`acceptsScheduledParam` pair, each
 * paired with its own ordinal map read off the node module rather than restated
 * here. This is the *capability* side of the census; the *expectation* side is
 * `offlineAutomationExemptions.ts`, and the whole point is that they are
 * different files with different authors.
 *
 * Known limit, stated rather than hidden: a Vitest census cannot construct the
 * real worklet nodes (no AudioContext, no wasm), so a node that gained a
 * `scheduleParam` without being added here would still be counted device-level.
 * The parameter-level half — this spec's subject — is not affected: within a
 * listed device the predicate under test is the shipped one.
 */
const SCHEDULING_CAPABLE_NODES: ReadonlyArray<{
    accepts: (deviceId: string) => boolean;
    params: Readonly<Record<string, number>>;
}> = [
    { accepts: isFermenterDevice, params: FERMENTER_AUTOMATION_PARAM_IDS },
    { accepts: isToasterDevice, params: TOASTER_AUTOMATION_PARAM_IDS },
    { accepts: isProofChamberDevice, params: PROOF_CHAMBER_AUTOMATION_PARAM_IDS },
];

type NativeDspCensus = {
    factoriesWalked: number;
    pairsWalked: number;
    verdicts: number;
    deviceLevelExemptions: number;
    parameterLevelExemptions: number;
    /** Pairs with no binding and no exemption row — the census's whole purpose. */
    uncovered: string[];
    /** Pairs that resolve a binding while still carrying an exemption row. */
    rottenExemptions: string[];
    noDescriptorFactories: string[];
    coveredPairs: string[];
    perDevice: Map<string, { covered: number; exempt: number; deviceLevel: boolean }>;
};

/**
 * Population from the registry production uses — `NATIVE_DSP_DEVICE_FACTORIES`
 * crossed with the `automatable: true` parameters each factory's
 * `getBuiltinPlugins()` descriptor declares — never from a list in this file
 * and never from the ordinal maps under test.
 */
function walkNativeDspCensus(): NativeDspCensus {
    const plugins = getBuiltinPlugins();
    const census: NativeDspCensus = {
        factoriesWalked: 0,
        pairsWalked: 0,
        verdicts: 0,
        deviceLevelExemptions: 0,
        parameterLevelExemptions: 0,
        uncovered: [],
        rottenExemptions: [],
        noDescriptorFactories: [],
        coveredPairs: [],
        perDevice: new Map(),
    };

    for (const factory of NATIVE_DSP_DEVICE_FACTORIES) {
        census.factoriesWalked += 1;
        const descriptors = plugins.filter((plugin) => factory.matches(plugin.id));
        if (descriptors.length === 0) {
            census.noDescriptorFactories.push(factory.type);
            continue;
        }

        const scheduled = SCHEDULING_CAPABLE_NODES.find((entry) =>
            descriptors.some((descriptor) => entry.accepts(descriptor.id))
        )?.params;
        const deviceLevel = scheduled === undefined;
        // The real strategy. A device-level entry is built with no scheduling
        // pair at all, exactly as `NativeDspDeviceStrategy` sees a node that
        // declares none — so its nulls come from the production branch rather
        // than from this file deciding the answer.
        const strategy = new NativeDspDeviceStrategy({
            workletNode: {} as AudioWorkletNode,
            ready: Promise.resolve({}),
            ...(scheduled
                ? {
                      acceptsScheduledParam: (name: string) => Object.hasOwn(scheduled, name),
                      scheduleParam: vi.fn(),
                  }
                : {}),
        });

        const tally = { covered: 0, exempt: 0, deviceLevel };
        for (const descriptor of descriptors) {
            for (const parameter of descriptor.parameters) {
                if (!parameter.automatable) {
                    continue;
                }
                census.pairsWalked += 1;
                const pair = `${factory.type}:${parameter.id}`;
                const binding = strategy.resolveOfflineAutomation(parameter.id);
                const exemption = deviceLevel
                    ? DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS[factory.type]
                    : PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS[factory.type]?.[parameter.id];

                if (binding) {
                    expect(binding.kind).toBe('segments');
                    census.verdicts += 1;
                    census.coveredPairs.push(pair);
                    tally.covered += 1;
                    if (exemption !== undefined) {
                        census.rottenExemptions.push(pair);
                    }
                    continue;
                }
                tally.exempt += 1;
                if (exemption === undefined) {
                    census.uncovered.push(pair);
                    continue;
                }
                if (deviceLevel) {
                    census.deviceLevelExemptions += 1;
                } else {
                    census.parameterLevelExemptions += 1;
                }
            }
        }
        census.perDevice.set(factory.type, tally);
    }

    return census;
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

    it('gives every native factory × automatable-parameter pair a verdict or an independently-authored exemption row', () => {
        const census = walkNativeDspCensus();

        // (ii) A verdict per pair, and the exemption table is the *other* source.
        // This assertion used to read `Object.hasOwn(map, id) === Object.hasOwn(map, id)`
        // — the census sourced its expectation from the very allow-list it
        // claimed to police, which is the example ADR 0015 opens with. The
        // expectation now comes from `offlineAutomationExemptions.ts`, which no
        // production code reads, so the two sides can disagree.
        expect(census.uncovered).toEqual([]);
        expect(census.rottenExemptions).toEqual([]);

        // (i) Cardinality pinned against the registry sourced directly, not
        // against the census's own walk — a walk that silently stopped at the
        // first factory would otherwise agree with itself.
        expect(census.factoriesWalked).toBe(NATIVE_DSP_DEVICE_FACTORIES.length);

        // (iv) The two classes are counted separately. A census reporting one
        // total hides the entire parameter-level class: a device passes a
        // per-device census the moment it schedules a single parameter, which is
        // how Fermenter's ninety survived the last census design.
        expect(census.verdicts).toBe(21);
        expect(census.deviceLevelExemptions).toBe(182);
        expect(census.parameterLevelExemptions).toBe(105);
        expect(census.deviceLevelExemptions + census.parameterLevelExemptions).toBe(287);

        // (v) `knead` is a factory entry and a canonical native device type with
        // no descriptor anywhere. It is not an exemption row: two of the three
        // laws that read a descriptor fail *open* when none is found, so a
        // Knead parameter is automatable and unclamped by default. AC-6 owns it.
        expect(census.noDescriptorFactories).toEqual([...NO_DESCRIPTOR_NATIVE_DEVICE_TYPES]);

        // Presence pin for the absence assertions above (ADR 0015 rule 4): the
        // walk reached real pairs rather than going blind and agreeing with an
        // empty extraction. A device-write census once spent 41 commits
        // comparing an empty extraction against a four-element expectation.
        expect(census.pairsWalked).toBe(census.verdicts + 287);
        expect(census.pairsWalked).toBeGreaterThan(300);
    });

    it('counts Fermenter’s own coverage as the parameter-level class, not as a covered device', () => {
        const census = walkNativeDspCensus();
        const fermenter = census.perDevice.get('fermenter');

        // The subject of SPEC-parameter-automation-coverage, stated as a number
        // the census can defend rather than a sentence in a header. Fermenter
        // declares 105 automatable parameters and carries offline ordinals for
        // 16 of them; the other 89 render frozen in a bounce, freeze or stem
        // export while the monitor rides them.
        expect(fermenter).toEqual({ covered: 16, exempt: 89, deviceLevel: false });
        // `oscWaveform` is the one this PR moved across, so it must be a verdict
        // and must NOT still carry an exemption row.
        expect(census.coveredPairs).toContain('fermenter:oscWaveform');
        expect(Object.hasOwn(PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS.fermenter ?? {}, 'oscWaveform')).toBe(false);
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
