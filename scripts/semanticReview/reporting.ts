/**
 * The report-shaping helpers that assemble a scan's scope and usage figures.
 *
 * Kept out of `run.ts` (which owns the plan and the assessment loop) and out of `report.ts` (which
 * owns validation and the summary) so neither exceeds its size ceiling. Both functions are pure.
 */

import { type SemanticScopeExclusion } from './contracts.ts';
import { estimateCost, type SemanticUsageTotals } from './provider.ts';
import { type SemanticScopeReport, type SemanticUsageReport } from './report.ts';
import { type SemanticScopeStates } from './scopeAccounting.ts';
import { type SemanticPlannedRequest } from './unitPriority.ts';

/** Builds the scope report from the plan's unit paths and the run's outcome counts. */
export function scopeReport(input: {
    readonly unitPaths: readonly string[];
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly truncated: readonly SemanticScopeExclusion[];
    readonly assessed: number;
    readonly cacheHits: number;
    readonly unassessed: readonly SemanticScopeExclusion[];
    /** The eligible units in admission order, with the class and evidence that placed each one. */
    readonly requestOrder: readonly SemanticPlannedRequest[];
    readonly states: SemanticScopeStates;
}): SemanticScopeReport {
    const discovered = new Set<string>([...input.unitPaths, ...input.excluded.map((entry) => entry.path)]).size;
    return {
        discovered,
        eligible: input.unitPaths.length,
        assessed: input.assessed,
        cacheHits: input.cacheHits,
        excluded: [...input.excluded],
        unassessed: [...input.unassessed],
        truncated: [...input.truncated],
        requestOrder: [...input.requestOrder],
        states: input.states,
    };
}

/** Renders usage totals into the report's usage shape. */
export function usageReport(usage: SemanticUsageTotals): SemanticUsageReport {
    return {
        networkAttempts: usage.networkAttempts,
        logicalRequests: usage.logicalRequests,
        retries: usage.retries,
        submittedBytes: usage.submittedBytes,
        actualInputTokens: usage.actualInputTokens,
        estimatedInputTokens: usage.estimatedInputTokens,
        attemptsWithUnknownUsage: usage.attemptsWithUnknownUsage,
        estimatedCostUsd: estimateCost(usage.actualInputTokens).usd,
        pricingConfigurationVersion: estimateCost(usage.actualInputTokens).pricingVersion,
    };
}
