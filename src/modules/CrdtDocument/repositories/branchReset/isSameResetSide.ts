import { type CrdtPersistenceAuthority } from '../crdtPersistence/persistenceAuthorityModel';

/**
 * Whether one authority is the project the other names.
 *
 * The epoch names the side: a reset mints a fresh epoch for the project it is
 * writing, so the target epoch is the replacement and the old epoch is the
 * project being replaced. The root lineage then proves the branch list this
 * marker carries still describes the durable root — a fork landing a new
 * lineage under the same epoch moved the project to a root that list does not
 * name. The revision is free: it only counts ordinary saves, and a save does
 * not change which project is durable.
 */
export function isSameResetSide(durable: CrdtPersistenceAuthority, side: CrdtPersistenceAuthority): boolean {
    return durable.epoch === side.epoch && durable.rootLineage === side.rootLineage;
}
