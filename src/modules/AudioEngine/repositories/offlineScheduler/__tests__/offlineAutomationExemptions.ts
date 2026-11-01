/**
 * Reason-bearing exemption table for the offline device-parameter automation
 * census (`offlineAutomationCoverage.spec.ts`), per ADR 0015 rule 2 (iii).
 *
 * This table is what stops the census being a tautology. The census used to
 * source its expectation from `FERMENTER_AUTOMATION_PARAM_IDS` — the same
 * allow-list whose regrowth it claimed to prevent — so every verdict it reached
 * was `Object.hasOwn(map, id) === Object.hasOwn(map, id)`. ADR 0015's own
 * context section cites that spec as the leading example of a guard whose only
 * reachable verdict is the one it already has.
 *
 * The census now walks `NATIVE_DSP_DEVICE_FACTORIES` crossed with
 * `getBuiltinPlugins()` and, for every pair, asserts that the device either
 * resolves an offline binding **or** carries a row here. The two sources are
 * independent: adding an ordinal to a node's param-id map without deleting its
 * row reds, and deleting a row while the pair is still incapable reds.
 *
 * Two classes, kept apart and counted separately, because a single total hides
 * the whole subject:
 *
 *  - **Device-level** — the node declares no `scheduleParam` at all, so one
 *    reason covers every parameter on the device. `DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS`.
 *  - **Parameter-level** — the device *does* schedule, but this parameter is not
 *    in its ordinal map. Every row needs its own reason. This table.
 *
 * The remaining rows state why their binding is absent; an unclassified row
 * continues to expose work that the census could otherwise miss.
 *
 * Generated from the registry walk, then committed. Regenerate by re-running the
 * census; do not hand-edit a row without changing the code it describes.
 */
export const PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
    {
        fermenter: {
            // The sole survivor is an absence of engine behaviour, not an
            // absence of wiring: no two values of it render differently, so an
            // ordinal for it could not carry a guard that is able to fail
            // (ADR 0015). The other 86 rows that stood here were bound by
            // SPEC-parameter-automation-coverage AC-4 and each one now carries a
            // per-parameter render-delta probe in
            // `wasm/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`.
            //
            // Two more left this table once the engine started reading their
            // fields. `portamentoMode`: `Layer::portamento_time_for_note_on`
            // suppresses the glide in legato mode when no key is down.
            // `grainPanSpread`: `Voice::render` restores the L/R balance for any
            // oscillator branch that declares a stereo pair, not only the unison
            // one, so the per-grain pan reaches the output. Both are pinned in
            // `crates/daw-dsp/tests/` and both carry ordinal probes.
            activeLayer:
                'class (b) structural: `active_layer` writes no DSP state — `MasterSynth::set_param` reads it only to route *subsequent* parameter writes to a layer, and `note_on_with_channel`/`render_layers` iterate `layers[..num_active_layers]` without consulting it. Binding it would also make the destination of every other scheduled lane depend on the order the schedules sit in `_paramAutomation`',
        },
        toaster: {
            swing: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
        },
    };

/**
 * Devices whose node supplies no `scheduleParam` at all. One reason covers every
 * automatable parameter the descriptor declares. These belong to the
 * **device-level** class, which SPEC-offline-live-collapse Phase 2 AC-4 owns;
 * SPEC-parameter-automation-coverage explicitly does not re-open them.
 */
export const DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS: Readonly<Record<string, string>> = {
    levain: 'LevainNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    'builtin-crumbs':
        'CrumbsNode supplies no scheduleParam — device-level class, SPEC-parameter-automation-coverage §8 (out of scope, reasoned exemption)',
    gluten: 'GlutenNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    crust: 'CrustNode supplies no scheduleParam — device-level class, SPEC-parameter-automation-coverage §8 (out of scope, reasoned exemption)',
    bacteria: 'BacteriaNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    grinder: 'GrinderNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    proof: 'ProofNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
};

/**
 * Factories with no descriptor anywhere in `getBuiltinPlugins()`. This is not
 * an exemption — a device with no descriptor is outside the range law and the
 * automatable law at once, and both of those fail **open**
 * (`DeviceParameterLaw.ts`: an unknown device type is returned unclamped and
 * reported automatable). Keep the empty population explicit so adding an
 * undescribed factory turns the census red instead of silently reopening it.
 */
export const NO_DESCRIPTOR_NATIVE_DEVICE_TYPES: readonly string[] = [];
