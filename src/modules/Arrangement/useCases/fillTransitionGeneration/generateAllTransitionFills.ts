import { type GeneratedFill } from '../../models/FillTransitionTypes';

import { detectTransitionPoints } from './detectTransitionPoints';
import { generateDrumFill } from './generateDrumFill';
import { generateRiser } from './generateRiser';
import { generateSweepDown } from './generateSweepDown';

export function generateAllTransitionFills(): GeneratedFill[] {
    const points = detectTransitionPoints();
    return points.map((param) => {
        if (param.toSection.toLowerCase().includes('chorus') || param.toSection.toLowerCase().includes('drop')) {
            return generateRiser(param.beat, 4);
        }
        if (param.toSection.toLowerCase().includes('break') || param.toSection.toLowerCase().includes('outro')) {
            return generateSweepDown(param.beat, 2);
        }
        return generateDrumFill(param.beat, 2, 'descending');
    });
}
