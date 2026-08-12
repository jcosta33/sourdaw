import { type ProjectContextAgentReferenceHistoryEntry } from '../models/ProjectContext';
import { agentReferenceHistoryStore } from '../stores/agentReferenceHistoryStore';

type ResolvedAgentReference = Omit<ProjectContextAgentReferenceHistoryEntry, 'referencedAt'>;

const MAX_REFERENCE_HISTORY_ENTRIES = 50;

export function recordResolvedAgentReferences(references: readonly ResolvedAgentReference[]): void {
    if (references.length === 0) {
        return;
    }
    const uniqueReferences = new Map(references.map((reference) => [reference.id, reference]));
    const referencedIds = new Set(uniqueReferences.keys());
    const retained = (agentReferenceHistoryStore.value ?? []).filter((entry) => !referencedIds.has(entry.id));
    const referencedAt = Date.now();
    const recorded = [...uniqueReferences.values()].map((reference) => ({ ...reference, referencedAt }));
    agentReferenceHistoryStore.set([...retained, ...recorded].slice(-MAX_REFERENCE_HISTORY_ENTRIES));
}
