import { projectLoadEpoch } from './helpers/runProjectLoadTransaction';

/** Capture the active project identity transition epoch for composition-owned projections. */
export function getProjectLoadEpoch(): number {
    return projectLoadEpoch.current;
}
