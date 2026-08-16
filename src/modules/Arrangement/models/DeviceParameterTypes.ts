/**
 * Device parameter and plugin descriptor type definitions.
 *
 * Pure types only — no catalog data, no helpers. The aggregated catalog
 * (`BUILTIN_PLUGINS`), variant builders, and query helpers live in
 * `DeviceParameter.ts`. Per-family descriptor data lives in
 * `./PluginDescriptors/*.ts`; those files import this module rather than
 * the aggregator to avoid circular dependencies.
 */

import { type DeviceTailDeclaration } from './DeviceTailTypes';

export type DeviceParameterType = 'float' | 'int' | 'bool' | 'choice';

/**
 * The settings the engine actually distinguishes, when they are *not* every
 * integer in `[minValue, maxValue]`.
 *
 * `minValue`/`maxValue` say how far a write may travel; for a stepped parameter
 * the implied legal set is "every integer in between", and for most of them
 * that is true. It is not true of a parameter whose engine resolves its input
 * onto a coarser set — `crust/oversampling` declares 1..32 while its cascade
 * only builds powers of two, so 26 of those 32 integers render bit-identical to
 * a neighbour. Declaring the set makes those positions unofferable rather than
 * inert: the control offers exactly `values`, and
 * `quantiseDeviceParameterValue` resolves a delivery onto them.
 *
 * `values` must be ascending, unique, and span `minValue`..`maxValue`
 * inclusive, and must contain `defaultValue` — held to that over the whole
 * registry in `DeviceParameterLaw.spec.ts`, because a set that does not reach
 * an endpoint would make the endpoint unreachable while the range still claims
 * it.
 *
 * **`resolution` is not a preference — it is a mirror.** A value that is not a
 * member still reaches the DSP by routes this declaration does not gate (a
 * project file, a preset, a learned MIDI CC), and the engine resolves it
 * itself. Whatever this says has to be what that engine does, or the fix has
 * only moved the disagreement. `DeviceLegalParameterValues.json` pins every
 * in-range value against the engine that answers it, on both sides of the
 * boundary.
 *
 * - `floor` — the greatest member at or below the value; the smallest member
 *   below the set. Both oversampling cascades work this way: a factor between
 *   two stages gets the stage under it, never the one above.
 * - `fallback` — a non-member resolves to `fallback` regardless of where it
 *   sits. `dutch-oven/algorithm` is a wire format whose dispatch is a `match`,
 *   so its reserved values 4 and 5 land on the `_ =>` arm rather than on a
 *   neighbour.
 */
export type LegalValueSet =
    | { values: readonly number[]; resolution: 'floor' }
    | { values: readonly number[]; resolution: 'fallback'; fallback: number };

export type DeviceParameter = {
    id: string;
    deviceId: string;
    name: string;
    type: DeviceParameterType;
    value: number;
    defaultValue: number;
    /**
     * The narrowest and widest value the engine will accept for this parameter.
     *
     * This is a **write law**, not a display hint: every device-parameter write
     * is held to it (see `DeviceParameterLaw`). It therefore has to describe
     * what the DSP actually accepts, and it can no longer double as the
     * convenient span for a knob.
     *
     * Before the law bound at the write, tightening this pair was free: it
     * changed the parameter picker and the knob and nothing else. It is not
     * free now. Narrowing it silently rewrites every value outside the new
     * range, including ones already shipped in demo projects, factory presets
     * and saved user projects.
     *
     * There is deliberately no separate "floor the knob offers" field. One was
     * tried and reintroduced the same defect one layer out: `RotaryKnob` clamps
     * to its `min`, so a knob floor above a stored value rewrites that value on
     * the first drag, one-way — the store keeps 0.05 forever and the user has
     * no way back to it. A control that needs usable resolution near the bottom
     * wants `scaling: 'log'`, which gives resolution without exclusion.
     */
    minValue: number;
    maxValue: number;
    /**
     * See {@link LegalValueSet}. Omitted means "every integer in the range is
     * its own setting", which is what a stepped parameter without this field
     * asserts.
     */
    legalSet?: LegalValueSet;
    unit: string;
    scaling?: 'log' | 'linear';
    choices?: string[];
    automatable: boolean;
    hasAutomation: boolean;
};

/**
 * Minimal parameter definition shape used by plugin descriptors within
 * this module. Each instrument module owns its own full param-def type;
 * this local type captures only the fields the descriptor mapping needs.
 * Models must not cross module boundaries — each descriptor file inlines
 * its own param array using this type rather than importing from the
 * instrument module.
 */
export type PluginParamDef = {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    unit: string;
    step?: number;
    scaling?: 'log' | 'linear';
    /** See {@link LegalValueSet}; descriptor builders copy it through. */
    legalSet?: LegalValueSet;
};

export type PluginFormat = 'builtin' | 'vst3' | 'clap' | 'au';

export type PluginPlatform = 'web' | 'native' | 'both';

export type DeviceParameterModulationDeclaration =
    | { availability: 'available'; mechanism: 'automation'; detail: string }
    | { availability: 'unavailable'; reason: string }
    | { availability: 'not-applicable'; reason: string };

export type DeviceGainCompensationDeclaration =
    | { availability: 'provided'; parameterId: string; detail: string }
    | { availability: 'unavailable'; reason: string }
    | { availability: 'not-applicable'; reason: string };

export type DeviceParameterGuidance = {
    semanticRole: string;
    perceptualRole: string;
    typicalRange: { minimum: number; maximum: number };
    interactions: readonly string[];
    risks: readonly string[];
    modulation: DeviceParameterModulationDeclaration;
};

export type DeviceCapabilityAvailability =
    { availability: 'available'; detail: string } | { availability: 'unavailable'; reason: string };

/**
 * Arrangement-owned meaning of a device. Runtime node and render capability
 * remains owned by AudioEngine and is composed separately for agent receipts.
 */
export type PluginDescriptorCapabilities = {
    instrumentGeneration: DeviceCapabilityAvailability;
    audioProcessing: DeviceCapabilityAvailability;
    audioAnalysis: DeviceCapabilityAvailability;
    referenceSignalGeneration: DeviceCapabilityAvailability;
};

export type PluginDescriptorGuidance = {
    usage: string;
    safety: readonly string[];
    interactions: readonly string[];
    risks: readonly string[];
    gainCompensation: DeviceGainCompensationDeclaration;
    parameters: Readonly<Record<string, DeviceParameterGuidance>>;
};

export type PluginDescriptor = {
    id: string;
    name: string;
    vendor: string;
    format: PluginFormat;
    category: 'instrument' | 'effect' | 'analyzer' | 'utility';
    parameters: DeviceParameter[];
    /** Numeric engine configuration persisted on newly added devices without
     * exposing a user-facing or automatable parameter. */
    internalParameterValues?: Readonly<Record<string, number>>;
    hasCustomUI: boolean;
    /** Which runtime this plugin is available on. Defaults to 'both'. */
    platform?: PluginPlatform;
    /**
     * How long this device keeps sounding after its input stops, so offline
     * export can reserve room for it. Omitted means "no tail" — the device
     * stops when its input does.
     */
    tail?: DeviceTailDeclaration;
    /** Owner-authored device meaning. Agent projections must not infer it from category. */
    capabilities?: PluginDescriptorCapabilities;
    /** Owner-authored operating guidance. Agent projections must not infer it. */
    guidance?: PluginDescriptorGuidance;
};
