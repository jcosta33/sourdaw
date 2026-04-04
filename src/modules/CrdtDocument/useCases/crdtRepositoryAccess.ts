/**
 * TEMPORARY MIGRATION SHIM
 *
 * Exposes a restricted subset of automergeRepository operations at the
 * public use-case layer so Collaboration does not reach into repositories/.
 *
 * Only the 8 operations Collaboration actually needs are exported — callers
 * cannot access the rest of the repository's API through this surface.
 *
 * Remove after the global import convergence pass — replace with proper
 * domain use cases for each operation (e.g. applyPeerSync, createSessionDoc).
 *
 * NOTE: This file intentionally exports multiple functions — an acknowledged
 * exception to the one-function-per-file rule. The grouping makes the shim
 * boundary visible and easy to delete in one shot during the convergence pass.
 */
import { type Doc, type ChangeFn } from '@automerge/automerge';
import { automergeRepository } from '../repositories/automergeRepository';

export function subscribeToCrdtChanges(listener: () => void): () => void {
    return automergeRepository.onChange(listener);
}

export function getCrdtDoc<DocShape = Record<string, unknown>>(id: string): Doc<DocShape> | undefined {
    return automergeRepository.getDoc<DocShape>(id);
}

export function createCrdtDoc(id: string): void {
    automergeRepository.createChildDoc(id);
}

type ReplaceCrdtDocInput = { id: string; doc: Doc<unknown> };
export function replaceCrdtDoc({ id, doc }: ReplaceCrdtDocInput): void {
    automergeRepository.replaceDoc(id, doc);
}

export function hasCrdtDoc(id: string): boolean {
    return automergeRepository.hasDoc(id);
}

export function getCrdtDocIds(): string[] {
    return automergeRepository.getDocIds();
}

export function removeCrdtDoc(id: string): void {
    automergeRepository.removeDoc(id);
}

type MutateCrdtDocInput<DocShape> = { id: string; changeFn: ChangeFn<DocShape> };
export function mutateCrdtDoc<DocShape = Record<string, unknown>>({ id, changeFn }: MutateCrdtDocInput<DocShape>): void {
    automergeRepository.changeDoc<DocShape>(id, changeFn);
}
