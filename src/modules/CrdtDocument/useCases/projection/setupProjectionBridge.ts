import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';

import { projectChangedCrdtSlots, projectCrdtToStores } from './projectProjection';

/**
 * Set up the projection bridge: subscribe to Automerge changes and hydrate stores.
 *
 * Honours the single-doc `docId` hint the repository threads through
 * `onChange` (§138.1): every project store is keyed inside the `DOC_PREFIX_ROOT`
 * document (see `createAutomergeStorage` call sites — all pass `DOC_PREFIX_ROOT`),
 * so a change to any *other* doc (a `branch_*` snapshot, `__branches__`) backs no
 * project store and must not trigger a full re-hydrate. A `undefined` hint marks a
 * bulk op (load / merge / snapshot) and always re-hydrates.
 *
 * Audit CC-1 — a change that a local CRDT-backed store performed also carries
 * the exact slots it wrote. Those slots are re-projected out of, not into, the
 * writing adapter (it already holds their truth); only projections derived from
 * a *sibling* slot still run. Document-origin changes name no slots and keep the
 * full re-projection, because the changed key set is not knowable from a merged
 * document.
 */
export function setupProjectionBridge(): () => void {
    return automergeRepository.onChange((docId?: string, hint?: { readonly localSlots: readonly string[] }) => {
        if (docId !== undefined && docId !== DOC_PREFIX_ROOT) {
            return;
        }
        if (hint) {
            projectChangedCrdtSlots({ changedSlots: hint.localSlots, origin: 'local-store' });
            return;
        }
        projectCrdtToStores();
    });
}
