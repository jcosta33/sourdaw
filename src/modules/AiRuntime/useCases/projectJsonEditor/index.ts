/**
 * JSON Editor flow — the new AI editing paradigm.
 *
 * Instead of 50+ discrete tools, the LLM sees the project as editable JSON
 * and returns the modified version. We diff, validate, and apply.
 */
export { executeJsonEdit, type JsonEditResult } from './executeJsonEdit';
export { serializeProjectState, type EditableProjectState } from './serializeProjectState';
export { diffProjectState, summarizeChanges, type ProjectChange } from './diffAndPatch';
export { applyProjectChanges } from './applyChanges';
export { buildJsonEditorPrompt } from './jsonEditorPrompt';
