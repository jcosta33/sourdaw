import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type BriefMixIntent } from './BriefMixIntent';
import { type PlannedBriefMixAlternative } from './BriefReading';
import { type PerceptualConstraintReading } from './PerceptualConstraint';
import { type ProjectContextProductionBrief } from './ProjectContext';
import { type RetainedCommand } from './RetainedCompilation';

/** What one `brief.compile` call leaves the tool loop: its receipt and, on success, the brief it composed. */
export type BriefCompileResult = {
    receipt: ApplicationToolReceipt;
    commands: readonly RetainedCommand[] | null;
    briefChangeLines: readonly string[] | null;
    /** The whole next brief the command writes, typed, for the planner that reads it before Confirm. */
    composedBrief: ProjectContextProductionBrief | null;
    mixIntent: BriefMixIntent | null;
    /** The named readings the request admits, kept apart so the two-key mix intent and its digest never change. */
    mixAlternatives?: readonly PlannedBriefMixAlternative[];
    /** The request's constraints the readings were prepared against; set whenever `mixAlternatives` is. */
    constraintReading?: PerceptualConstraintReading;
};
