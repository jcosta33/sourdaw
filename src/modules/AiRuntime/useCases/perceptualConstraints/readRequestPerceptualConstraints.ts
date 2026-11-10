import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { unionPerceptualConstraintReadings } from '../../transformers/unionPerceptualConstraintReadings';

import { compilePerceptualConstraints } from './compilePerceptualConstraints';

/**
 * The perceptual constraints a batch is held to: those its own request text states, read against the
 * project now, and those an earlier request of its chain stated, exactly as they were recorded when
 * that request was admitted. A refinement therefore never sheds the constraints of the card it
 * refines, and an earlier request's text is never read again against a project that has since moved.
 */
export function readRequestPerceptualConstraints(input: {
    prompt: string;
    context: ProjectContext;
    recorded?: PerceptualConstraintReading;
}): PerceptualConstraintReading {
    return unionPerceptualConstraintReadings(input.recorded, compilePerceptualConstraints(input.prompt, input.context));
}
