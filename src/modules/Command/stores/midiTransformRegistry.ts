import {
    MIDI_TRANSFORM_DESCRIPTORS,
    MIDI_TRANSFORM_NAMES,
    type MidiTransformDescriptor,
    type MidiTransformImplementation,
    type MidiTransformImplementationMap,
    type MidiTransformName,
    type MidiTransformRegistration,
} from '../models/MidiTransform';

/**
 * Deterministic MIDI transform registry, shared across the app.
 *
 * Lives in `stores/` for the same reason `handlerRegistry` does: it is shared mutable state that
 * bootstrap fills once, not a business operation. Command publishes the descriptors and the compiler
 * reads them; the module that owns the generators registers those here, which is what keeps Command
 * and the compiler free of any dependency on it.
 *
 * A descriptor is only visible once its generator is registered. Publishing a schema a planner can
 * discover but nothing can run would turn a wiring gap into a refusal the planner cannot understand.
 */

const registry = new Map<MidiTransformName, MidiTransformImplementation>();

export function registerMidiTransforms(implementations: MidiTransformImplementationMap): void {
    for (const name of MIDI_TRANSFORM_NAMES) {
        if (registry.has(name)) {
            // A second registration is a bootstrap programming error: which generator answers a
            // transform name would depend on wire-up order, and so would the notes a musician sees.
            throw new Error(`[midiTransformRegistry] Duplicate registration for MIDI transform: ${name}`);
        }
        if (typeof implementations[name] !== 'function') {
            throw new TypeError(`[midiTransformRegistry] No implementation registered for MIDI transform: ${name}`);
        }
    }
    for (const name of MIDI_TRANSFORM_NAMES) {
        registry.set(name, implementations[name]);
    }
}

/**
 * Every transform name a registrar must cover, whether or not anything is registered yet. A caller
 * assembling the implementation map reads the list it has to satisfy rather than restating it.
 */
export function getMidiTransformNames(): readonly MidiTransformName[] {
    return MIDI_TRANSFORM_NAMES;
}

export function getMidiTransformDescriptors(): readonly MidiTransformDescriptor[] {
    return [...registry.keys()].map((name) => MIDI_TRANSFORM_DESCRIPTORS[name]);
}

export function getMidiTransform(name: string): MidiTransformRegistration | undefined {
    const registeredName = MIDI_TRANSFORM_NAMES.find((candidate) => candidate === name);
    const implementation = registeredName === undefined ? undefined : registry.get(registeredName);
    return registeredName === undefined || implementation === undefined
        ? undefined
        : { descriptor: MIDI_TRANSFORM_DESCRIPTORS[registeredName], implementation };
}

export function clearMidiTransformRegistry(): void {
    registry.clear();
}
