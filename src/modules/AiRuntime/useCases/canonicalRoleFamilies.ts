import { getCanonicalTrackRoleOptions } from '#/modules/Project/useCases';

import { type SemanticCommandListRoleFamily } from '../models/SemanticCommandList';

/**
 * Every canonical track role recipe discovery and the semantic command list `roleFamily`
 * predicate can resolve to. Kept in `useCases/` rather than `models/` or `services/` because its
 * exhaustiveness guarantee needs `CanonicalRole`, which only resolves through Project's
 * `useCases/` barrel — a `models-are-pure`/`services-must-stay-pure` import neither layer may
 * make. A caller in either layer instead reads this table and passes it in as data.
 */
export type CanonicalRole = ReturnType<typeof getCanonicalTrackRoleOptions>[number];

/** Every canonical role this table can narrow a raw project evidence string down to. */
export const CANONICAL_ROLE_OPTIONS = getCanonicalTrackRoleOptions();

/**
 * Every canonical track role's recipe/set-predicate role family.
 *
 * `fx` and `unknown` map to no role family: a track holding either needs an explicit `role`
 * argument or predicate before it can be filtered by role family at all. Keyed by the complete
 * `CanonicalRole` union, so a role this table forgets to place fails typecheck rather than
 * silently resolving to no role family.
 */
export const CANONICAL_ROLE_TO_RECIPE_ROLE: Readonly<Record<CanonicalRole, SemanticCommandListRoleFamily | null>> = {
    kick: 'drums',
    snare: 'drums',
    'hi-hat': 'drums',
    tom: 'drums',
    cymbal: 'drums',
    percussion: 'drums',
    drums: 'drums',
    'lead vocal': 'vocal',
    'backing vocal': 'vocal',
    bass: 'bass',
    guitar: 'guitar',
    keys: 'keys',
    synth: 'keys',
    pad: 'keys',
    bus: 'bus',
    master: 'master',
    fx: null,
    unknown: null,
};
