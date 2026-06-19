import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

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
}
