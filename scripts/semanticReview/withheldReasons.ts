/**
 * The withheld and nothing-sent reasons the scan and verify routes share.
 *
 * A refused region, path or finding reads one vocabulary whichever route produced it, so a reviewer reads
 * the same cause for the same fact. Kept apart from the collector that emits most of them, so both stay
 * inside their own ceilings.
 */

import type { EvidenceSide, SemanticScopeExclusion } from './contracts.ts';

/**
 * The scope-exclusion code the content screen records in `excluded`, and the withheld-scope code it
 * records in `truncated`. They are two vocabularies, not two spellings of one: an exclusion says the
 * path contributed no unit and was skipped whole, while a withheld code says why the reference never
 * left the machine. Only the scan records an exclusion, because only it plans units; both routes record
 * the withheld code, and `CREDENTIAL_SHAPED_WITHHELD_CODE` is shared so one withheld reference cannot
 * read two reasons.
 */
/** The content screen's withheld cause, emitted by the scan's admission and by verify's finding evidence. */
export const CREDENTIAL_SHAPED_WITHHELD_CODE = 'evidence-withheld-credential-shaped';

/** The path screen's withheld cause, emitted by both routes for a path the sensitive-path list covers. */
export const SENSITIVE_PATH_WITHHELD_CODE = 'evidence-withheld-sensitive-path';

export type WithheldRegionCause = 'region' | 'request' | 'total' | 'hunk-beyond-file';

/** The withheld-region code each cause emits, so every cause shares one vocabulary. */
function withheldCauseCode(cause: WithheldRegionCause): string {
    if (cause === 'region') {
        return 'region-exceeds-per-region-budget';
    }
    if (cause === 'request') {
        // The region fits the per-region ceiling; the request that would carry it — the state plus the
        // questions, whose text depends on which regions are supplied — does not fit the per-request
        // state ceiling. Naming the per-region code here would describe a budget no admitted region can
        // exceed.
        return 'request-exceeds-state-budget';
    }
    if (cause === 'total') {
        return 'total-evidence-budget-exhausted';
    }
    return 'hunk-beyond-file';
}

/**
 * Whether a withheld region carries the contract class, from its own side and the contract-carrying
 * classification of that side.
 *
 * A context region always does: it is a document read at the contract source revision, supplied as
 * context because a rule declared it needs a contract, so its own path and content never decide its
 * class. Every other region reads the classification of the side the region comes from. Both routes
 * name a withheld reference through this one rule, so the same reference reads the same reason
 * whichever route produced it — a caller-supplied context path that no contract-carrying
 * classification covers is still named contract on both.
 */
export function withheldRegionCarriesContract(side: EvidenceSide, classifiedContractCarrying: boolean): boolean {
    return side === 'context' || classifiedContractCarrying;
}

/**
 * Whether one withheld entry names the per-region size gate rather than evidence that was never admissible.
 * Read from the same code generator the entry was written with, so the two cannot drift apart.
 */
function namesRegionSize(reason: string): boolean {
    return reason.startsWith(`${withheldCauseCode('region')} (`);
}

/**
 * Why a path or a finding was left with nothing to send: the size of its regions, or evidence that was
 * not admissible at all. The scan planner and the verify collector choose between the same two reasons
 * from the same record — the withheld entries — so the choice lives here. A branch that read only "no
 * region survived" mislabelled a size refusal as inadmissibility, which is a different claim: the
 * evidence was admissible and the request had no room for it.
 */
export function nothingSentReason(
    withheld: readonly SemanticScopeExclusion[]
): 'no-evidence-region-within-budget' | 'no-admissible-evidence' {
    return withheld.length > 0 && withheld.every((entry) => namesRegionSize(entry.reason))
        ? 'no-evidence-region-within-budget'
        : 'no-admissible-evidence';
}

/**
 * The one withheld-region vocabulary the scan and verify routes share. The cause stays the code that
 * names why the region was not sent — `region-exceeds-per-region-budget` for one over the per-region
 * ceiling, `request-exceeds-state-budget` for one the request carrying it cannot fit beside the regions
 * already kept, `total-evidence-budget-exhausted` for one the run's total could not take, or
 * `hunk-beyond-file` for one naming lines this revision does not hold — and `contract` joins the side
 * qualifier for a region `withheldRegionCarriesContract` classifies contract, so the same withheld
 * reference reads the same whichever route produced it. Every other region keeps the plain
 * `<code> (<side>)` form.
 *
 * Two causes carry no side qualifier, because each is decided before a region has a side class to join:
 * `CREDENTIAL_SHAPED_WITHHELD_CODE`, which the scan's admission and verify's finding evidence both emit,
 * and `SENSITIVE_PATH_WITHHELD_CODE`, which the path screen emits on both. Neither is the
 * scope-exclusion code `credential-shaped-content-excluded`: that code is recorded only in `excluded`,
 * by the scan alone, because only the scan plans units and an exclusion is what the planner skips on.
 *
 * The qualifier names the region's own content class — the side's `contractCarrying` classification, or
 * the contract-context class — and never the admission tier. A source a contract-carrying spec covers
 * ranks in that spec's tier and a contract-needing file ranks above the context its rules charge, yet
 * both are recorded with the plain side form because their own content carries no contract. The tier is
 * the order admission attempts the record in, not a property of what was withheld.
 */
export function withheldRegionReason(contractCarrying: boolean, side: string, cause: WithheldRegionCause): string {
    const base = withheldCauseCode(cause);
    return contractCarrying ? `${base} (${side}, contract)` : `${base} (${side})`;
}
