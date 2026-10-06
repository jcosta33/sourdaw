/**
 * The reference the user loaded for comparison: figures only, for this session.
 *
 * Runtime only, and deliberately outside the project: a reference is the user's own listening aid,
 * not project truth, so it is never written to the document, never cached as audio, and never
 * restored into a later session. Loading another replaces it; clearing it empties the slot.
 */

import { createStore } from '#/infra/store/createStore';
import { type analyzeAgentReferenceBuffer } from '#/modules/AudioAnalysis/useCases';

/**
 * What the application keeps of a reference audio file: the figures measured from it and the shape
 * of what was measured. The samples are never kept.
 *
 * `name` is the file's base name, held for the user's own display; it never reaches a tool receipt or
 * a provider. The planner names a reference by `referenceId` and `contentAddress` alone.
 */
type AgentReference = ReturnType<typeof analyzeAgentReferenceBuffer> & {
    readonly referenceId: string;
    readonly name: string;
    readonly contentAddress: string;
};

/** `loadEpoch` names the latest load or clear: a load whose epoch is no longer current was superseded. */
type AgentReferenceState = { reference: AgentReference | null; loadEpoch: number };

export const agentReferenceStore = createStore<AgentReferenceState>({
    initialData: { reference: null, loadEpoch: 0 },
});

function readState(): AgentReferenceState {
    return agentReferenceStore.value ?? { reference: null, loadEpoch: 0 };
}

/** The loaded reference, or `null` when the user has loaded none. */
export function readAgentReference(): AgentReference | null {
    return readState().reference;
}

/** Start a load: it supersedes every earlier one, and the epoch it returns is what it must still hold to store. */
export function beginAgentReferenceLoad(): number {
    const state = readState();
    const loadEpoch = state.loadEpoch + 1;
    agentReferenceStore.set({ ...state, loadEpoch });
    return loadEpoch;
}

/** Store a reference unless a clear or a newer load superseded the load that measured it. */
export function storeAgentReference(input: { loadEpoch: number; reference: AgentReference }): boolean {
    const state = readState();
    if (state.loadEpoch !== input.loadEpoch) {
        return false;
    }
    agentReferenceStore.set({ ...state, reference: input.reference });
    return true;
}

/** Empty the slot and supersede any load still in flight. */
export function emptyAgentReference(): void {
    agentReferenceStore.set({ reference: null, loadEpoch: readState().loadEpoch + 1 });
}
