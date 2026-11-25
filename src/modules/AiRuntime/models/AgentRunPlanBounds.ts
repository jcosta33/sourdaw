export const MAX_COLLECTION_LENGTH = 256;
/**
 * Every batch preview of a run appends its verification receipts to the plan, so the list grows
 * with the run rather than with one turn. A vibe run knows that count before it is scheduled — one
 * receipt per measurement request — and its whole-run fit refuses a run that would pass this bound,
 * so a scheduled run never meets it. The verification receipts' byte allowances are derived from
 * it (`readApplicationVerificationReceiptLimits`). An ordinary song's complete vibe run (24 tracks,
 * eight sections, eleven batches) persists 487, about half of it.
 */
export const MAX_PLAN_APPLICATION_TOOL_RECEIPTS = 1024;
/**
 * `planAgentRun` derives one capability per application-tool receipt beside the action-catalog,
 * budget, asset and data-policy entries, so a plan's capabilities are bounded by its receipts plus
 * the allowance every other collection keeps.
 */
export const MAX_PLAN_CAPABILITIES = MAX_PLAN_APPLICATION_TOOL_RECEIPTS + MAX_COLLECTION_LENGTH;
