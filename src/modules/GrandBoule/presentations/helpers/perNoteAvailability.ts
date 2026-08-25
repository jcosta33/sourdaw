/**
 * Grand Boule per-note voicing availability (audit MD-2 — honest surface).
 *
 * The Per-Note editor captures per-key physical-model overrides (hammer
 * hardness, mass, damper firmness, …) and dispatches them to the engine as
 * `engine.setParam({ name: 'perNote.<key>.<param>' })`. The native engine does
 * not consume them: `GrandBouleEngine::set_param`
 * (`crates/daw-dsp/src/grand_boule/engine.rs`) has no `perNote.*` arm and drops
 * those names on its `_ => {}` fallback, and `PerNoteValues` is declared but
 * never stored nor read by `note_on_with_pitch`. Every knob is therefore inert,
 * so the surface claims a capability the engine does not provide.
 *
 * The editor stays hidden until the engine consumes these values. Its store,
 * use cases, and wire names remain intact.
 *
 * Flip this to `true` once the engine applies per-note overrides.
 */
// Typed `boolean` (not the literal `false`) so consumers gate on a flag that is
// meant to flip, not a value narrowed to a constant.
export const GRAND_BOULE_PER_NOTE_AVAILABLE: boolean = false;
