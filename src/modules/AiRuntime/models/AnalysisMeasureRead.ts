import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type MeasuredPreview } from './MeasuredPreview';
import { type RetainedCommand } from './RetainedCompilation';

/**
 * One `analysis.measure` call as the planning loop sees it: the receipt the provider reads, and —
 * only for a successfully measured preview — the commands that preview rendered and what it
 * measured, which the loop retains by call id for a proposal to adopt.
 */
export type AnalysisMeasureRead = {
    receipt: ApplicationToolReceipt;
    commands: readonly RetainedCommand[] | null;
    measuredPreview: MeasuredPreview | null;
};
