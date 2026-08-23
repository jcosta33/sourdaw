import { describe, it, expect, vi } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { FERMENTER_AUTOMATION_PARAM_IDS, isFermenterDevice } from '../../../engine/FermenterNode';
import { GRAND_BOULE_AUTOMATION_PARAM_IDS, isGrandBouleDevice } from '../../../engine/GrandBouleNode';
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
 * paired with its own capability map read off the node module rather than restated
 * here. This is the *capability* side of the census; the *expectation* side is
 * `offlineAutomationExemptions.ts`, and the whole point is that they are
 * different files with different authors.
 *
 * **Be clear about which half of this census is load-bearing.**
 *
 * The *device-level* half is tautological and is not a capability check. This
 * table decides which branch the walk takes, so for a device absent from it the
 * strategy is constructed with no scheduling pair and returns null by
 * construction — `null === null`. It is a **population** guard: it proves the
 * enumeration reached the device and that the device carries a reason, not that
 * the device is genuinely incapable. A node that grew a `scheduleParam` without
 * being added here would still be counted device-level and nothing would red.
 * Closing that needs a real AudioContext and a real worklet, which Vitest does
 * not have.
 *
 * The *parameter-level* half — this spec's subject — is not tautological,
 * because the verdict and the expectation come from different files: the
 * capability maps below versus `offlineAutomationExemptions.ts`.
 *
 * One more thing not to overstate: this re-implements `acceptsScheduledParam`
 * as `Object.hasOwn(map, name)` rather than calling the node's own, which is
 * created inside `createFermenterNode` and unreachable here. What is shipped
 * and under test is the **capability map**; the predicate around it is restated.
 * Fermenter's map ordinals are pinned against the real binary by
 * `wasm/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`.
 */
const SCHEDULING_CAPABLE_NODES: ReadonlyArray<{
    accepts: (deviceId: string) => boolean;
    params: Readonly<Record<string, number>>;
}> = [
    { accepts: isFermenterDevice, params: FERMENTER_AUTOMATION_PARAM_IDS },
    { accepts: isToasterDevice, params: TOASTER_AUTOMATION_PARAM_IDS },
    { accepts: isProofChamberDevice, params: PROOF_CHAMBER_AUTOMATION_PARAM_IDS },
    { accepts: isGrandBouleDevice, params: GRAND_BOULE_AUTOMATION_PARAM_IDS },
];

type NativeDspCensus = {
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
        const descriptors = plugins.filter((plugin) => factory.matches(plugin.id));
        if (descriptors.length === 0) {
            census.noDescriptorFactories.push(factory.type);
            continue;
        }

        const scheduled = SCHEDULING_CAPABLE_NODES.find((entry) =>
            descriptors.some((descriptor) => entry.accepts(descriptor.id))
        )?.params;
        const deviceLevel = scheduled === undefined;
        // The real strategy, but note which way the causality runs: for a
        // device absent from SCHEDULING_CAPABLE_NODES this file supplies no
        // scheduling pair, so the null below is this file's decision, not the
        // device's. Only the parameter-level branch asks a question whose answer
        // this file does not already contain.
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

        // (iv) The two classes are counted separately. A census reporting one
        // total hides the entire parameter-level class: a device passes a
        // per-device census the moment it schedules a single parameter, which is
        // how Fermenter's ninety survived the last census design.
        //
        // These three exact counts are also the presence pin for the two empty
        // assertions above (ADR 0015 rule 4). A walk that went blind reaches
        // zero pairs and cannot produce the pinned counts below, so
        // `uncovered === []` cannot
        // be satisfied by an empty extraction — the shape that let a device-write
        // census spend 41 commits comparing nothing against a four-element
        // expectation.
        //
        // 21 → 107 verdicts and 105 → 19 parameter-level exemptions: 86 of
        // Fermenter's remaining parameters were bound (AC-4). The device-level
        // count is untouched, which is the point of counting the two classes
        // apart — parameter-level work must not move a device-level number.
        //
        // 107 → 109 verdicts and 19 → 17 parameter-level exemptions, and those
        // two must move together by the same amount: `verdicts` counts pairs
        // that resolve a *binding*, so a parameter changing class from exempt to
        // bound leaves this pair total up one and that exemption total down one.
        // The two parameters are `portamentoMode` and `grainPanSpread`, both of
        // which were exempt only because the engine discarded what they said —
        // `Layer::portamento_time_for_note_on` and the generalised stereo
        // restoration in `Voice::render` now read them.
        // Grand Boule's five automatable parameters now share its offline
        // worklet scheduling path, so 109 covered pairs becomes 114.
        expect(census.verdicts).toBe(114);
        // Moving Grand Boule out of the device-level class removes its five
        // parameter pairs from that count.
        expect(census.deviceLevelExemptions).toBe(182);
        // 17 → 23: #1539's six `decay_eq_*` bands on `dutch-oven`. They land in
        // this class rather than in `verdicts` because the Dutch Oven declares
        // exactly two offline ordinals (`mix`, `decay`) and always has — the
        // fifteen rows they join say the same thing — so a new automatable
        // parameter on this device arrives exempt by default. A verdict total
        // that had moved instead would mean someone wired ordinals, which is a
        // change to a wire format the crate shares and is not what that PR did.
        expect(census.parameterLevelExemptions).toBe(23);

        // (v) Every native factory now has a descriptor. This stays a separate
        // census class because an undescribed factory falls outside both the
        // parameter range and automation laws; neither exemption table may hide
        // it.
        expect(census.noDescriptorFactories).toEqual([...NO_DESCRIPTOR_NATIVE_DEVICE_TYPES]);
    });

    it('counts Fermenter’s own coverage as the parameter-level class, not as a covered device', () => {
        const census = walkNativeDspCensus();
        const fermenter = census.perDevice.get('fermenter');

        // The subject of SPEC-parameter-automation-coverage, stated as a number
        // the census can defend rather than a sentence in a header. Fermenter
        // declares 105 automatable parameters. 104 now carry offline ordinals;
        // the one that does not is an absence of *engine behaviour* — see its
        // row in `offlineAutomationExemptions.ts` — rather than a parameter that
        // renders frozen in a bounce while the monitor rides it.
        expect(fermenter).toEqual({ covered: 104, exempt: 1, deviceLevel: false });
        // Spot-checks on both sides of the move, so a regression that reverted
        // the binding en masse cannot satisfy the totals by shifting a count.
        // `oscWaveform` came across in an earlier PR; `additiveTilt` is the most
        // expensive setter in the newly bound set and `grainPanSpread` the last
        // ordinal, so a truncated table loses it first.
        for (const paramId of ['oscWaveform', 'additiveTilt', 'grainPanSpread']) {
            expect(census.coveredPairs).toContain(`fermenter:${paramId}`);
            expect(Object.hasOwn(PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS.fermenter ?? {}, paramId)).toBe(false);
        }
        // And the one that stayed behind is exempt rather than silently dropped:
        // a pair with neither a binding nor a row lands in `uncovered` above, so
        // this pins which side of the split it is on.
        expect(Object.keys(PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS.fermenter ?? {}).sort()).toEqual([
            'activeLayer',
        ]);
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
