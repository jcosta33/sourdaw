/**
 * DSO Editor — the spec-compliant LLM editing system.
 *
 * Replaces the old tool-calling approach and the interim JSON editor.
 * The LLM emits typed Domain-Specific Operations (DSOs), not raw JSON blobs.
 */
export { executeDsoEdit, type DsoEditResult } from './executeDsoEdit';
export { serializeLogicalState, buildProjectSummary, getRevision, logEdit } from './serializeLogicalState';
export { buildDsoPrompt } from './dsoPrompt';
export { resolveDsoNames, validateDsos, executeDsos } from './compileDso';
