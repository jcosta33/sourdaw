export function formatSectionRenderReviewSummary(
    reviewRequiredSectionRenders: readonly { jobId: string; warnings: readonly string[] }[]
): string {
    return reviewRequiredSectionRenders.map(({ jobId, warnings }) => `${jobId} (${warnings.join('; ')})`).join(', ');
}
