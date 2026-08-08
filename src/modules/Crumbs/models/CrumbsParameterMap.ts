import { type EnvelopeParams, type VoiceStackParams } from './CrumbsTypes';

/**
 * The Crumbs knob parameters that ride `Device.parameterValues`.
 *
 * These ids are the *wire contract* in three places at once, and all three have
 * to keep agreeing or a knob goes quiet or stops surviving a reload:
 *
 *  1. `CRUMBS_DESCRIPTOR.parameters[].id` — the declared range a write is clamped
 *     to, and the population an automation lane can be drawn on.
 *  2. `parse_crumbs_param` (`crates/daw-dsp/src/crumbs/types.rs:316`) — the
 *     camelCase names the engine matches. An unmatched name is not an error
 *     there, it is a `None`, so a typo is silent.
 *  3. `Device.parameterValues` keys, which `projectTrackToLiveStrip` replays into
 *     the worklet on project open.
 *
 * The list is duplicated rather than imported from `CRUMBS_DESCRIPTOR`: models do
 * not cross module boundaries. `crumbsParameterRegistry.spec.ts` derives the
 * population from the descriptor at test time and holds this map to it, so the
 * duplication cannot drift silently — adding a parameter to the descriptor without
 * adding it here reds.
 *
 * `filterType` is deliberately absent: it declares no descriptor parameter, so it
 * has no range to be clamped to and no automation surface. The three `voiceStack`
 * controls used to be absent for the same reason and no longer are — they declare
 * ranges now, checked against both knob travel and the engine's own clamps, and
 * they persist and automate like the rest.
 */
export const CRUMBS_PERSISTED_PARAM_IDS = [
    'masterGain',
    'attack',
    'hold',
    'decay',
    'sustain',
    'release',
    'filterCutoff',
    'filterResonance',
    'tune',
    'pan',
    'stackCount',
    'detuneSpread',
    'stackSpread',
] as const;

export type CrumbsPersistedParamId = (typeof CRUMBS_PERSISTED_PARAM_IDS)[number];

/**
 * Where a persisted parameter lives on the session state.
 *
 * The session store is not flat — the five envelope values are nested under
 * `envelope`, the three voice-stack values under `voiceStack` — so a parameter id
 * alone cannot address a field. This is the one table that says which, and both
 * the write path (`setCrumbsParamWithAudio`) and the read-back path
 * (`hydrateCrumbsStateFromProject`) go through it, so a knob cannot be stored
 * under one field and restored into another.
 */
export type CrumbsParamTarget =
    | { readonly kind: 'envelope'; readonly key: keyof EnvelopeParams }
    | { readonly kind: 'voiceStack'; readonly key: keyof VoiceStackParams }
    | { readonly kind: 'root'; readonly key: 'masterGain' | 'filterCutoff' | 'filterResonance' | 'tune' | 'pan' };

export const CRUMBS_PARAM_TARGETS: Readonly<Record<CrumbsPersistedParamId, CrumbsParamTarget>> = {
    masterGain: { kind: 'root', key: 'masterGain' },
    attack: { kind: 'envelope', key: 'attack' },
    hold: { kind: 'envelope', key: 'hold' },
    decay: { kind: 'envelope', key: 'decay' },
    sustain: { kind: 'envelope', key: 'sustain' },
    release: { kind: 'envelope', key: 'release' },
    filterCutoff: { kind: 'root', key: 'filterCutoff' },
    filterResonance: { kind: 'root', key: 'filterResonance' },
    tune: { kind: 'root', key: 'tune' },
    pan: { kind: 'root', key: 'pan' },
    stackCount: { kind: 'voiceStack', key: 'stackCount' },
    detuneSpread: { kind: 'voiceStack', key: 'detuneSpread' },
    stackSpread: { kind: 'voiceStack', key: 'stackSpread' },
};

/** Whether an arbitrary string names a Crumbs parameter that is persisted. */
export function isCrumbsPersistedParamId(value: string): value is CrumbsPersistedParamId {
    return Object.hasOwn(CRUMBS_PARAM_TARGETS, value);
}
