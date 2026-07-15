import { type CrdtPersistenceAuthority } from './persistenceAuthorityModel';

export function arePersistenceAuthoritiesEqual(
    left: CrdtPersistenceAuthority,
    right: CrdtPersistenceAuthority
): boolean {
    return left.epoch === right.epoch && left.revision === right.revision && left.rootLineage === right.rootLineage;
}
