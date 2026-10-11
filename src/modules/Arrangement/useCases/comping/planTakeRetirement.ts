import { deriveTakeRetirement } from '../../services/deriveTakeRetirement';
import { takeLaneStore } from '../../stores/takeLaneStore';

export type TakeRetirementPlan = NonNullable<ReturnType<typeof deriveTakeRetirement>>;

/**
 * The one derivation of "which takes retiring clip ids remove, and which lanes
 * that leaves behind".
 *
 * A lane that loses no take is carried through untouched. A lane that keeps
 * takes keeps its own comp regions except those naming a take this call
 * actually removed — a region that named a take this removal did not touch
 * stays, dangling or not. By default, a lane whose last take named a retiring
 * clip is retired whole. `retiredLanes` holds each touched lane exactly as it was
 * before the removal, with the index it held and the take ids this call
 * retired, so an undo can put back exactly those takes and no others.
 *
 * Returns null when the store is absent, no clip id was given, or no take
 * names a retiring clip.
 * A joined re-key transition can preserve its captured identities here so
 * that it remains their sole owner, including when they are a lane's last takes.
 * Time replay can preserve specified empty lane hosts when it owns only
 * disappearing clip facets, rather than those live lanes themselves.
 */
export function planTakeRetirement(
    clipIds: readonly string[],
    preservedTakeIds?: ReadonlySet<string>,
    options?: { readonly preservedLaneIds: ReadonlySet<string> }
): TakeRetirementPlan | null {
    return deriveTakeRetirement({
        lanes: takeLaneStore.value?.lanes ?? null,
        clipIds,
        preservedTakeIds,
        preservedLaneIds: options?.preservedLaneIds,
    });
}
