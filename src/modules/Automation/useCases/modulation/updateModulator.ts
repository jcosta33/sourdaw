import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { revertMappingsToBase } from './revertMappingsToBase';

/**
 * The fields a modulator patch may change. Deliberately excludes:
 *  - `id`: identity is immutable.
 *  - `mappings`: a whole-array spread would replace every mapping wholesale,
 *    silently dropping user-tuned destinations. Mappings have dedicated
 *    use-cases (`addMapping`/`updateMapping`/`removeMapping`).
 *  - `kind` / `config`: the kind discriminator is duplicated on both
 *    `Modulator.kind` and `config.kind` (the UI labels on the former, the engine
 *    computes on the latter). Patching one without the other desyncs them, so a
 *    kind/config change is not expressible as a partial patch — it would require
 *    rebuilding the modulator.
 */
export type ModulatorPatch = Partial<Pick<Modulator, 'name' | 'enabled' | 'trackId'>>;

export function updateModulator(id: string, patch: ModulatorPatch): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    const previous = state.modulators.find((m) => m.id === id);
    modulationStore.set({
        modulators: state.modulators.map((m) =>
            m.id === id
                ? {
                      ...m,
                      ...patch,
                      // Re-pin the structural fields after the spread so even a
                      // cast caller cannot replace identity, the kind/config
                      // discriminator pair, or the mappings array through this
                      // use-case.
                      id: m.id,
                      kind: m.kind,
                      config: m.config,
                      mappings: m.mappings,
                  }
                : m
        ),
    });

    // Disabling only stops `applyModulationToEngine`'s per-tick writes; the
    // engine keeps the last override it was handed, so the parameter stays
    // frozen at an arbitrary point of the waveform while the UI says the
    // modulator is off. The removal paths already hand the parameter back
    // (`removeModulator`, `removeMapping`); a disable is the same event for the
    // engine and needs the same restore. Guarded on the *transition* so a
    // rename, or a disable of an already-disabled modulator, writes nothing.
    if (previous?.enabled === true && patch.enabled === false && previous.mappings.length > 0) {
        revertMappingsToBase(previous.mappings);
    }
}
