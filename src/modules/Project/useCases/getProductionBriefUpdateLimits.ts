import { PRODUCTION_BRIEF_UPDATE_LIMITS } from '../models/ProductionBriefUpdate';

/** The bounds `composeProductionBriefUpdate` enforces, so a provider schema can state the same ones. */
export function getProductionBriefUpdateLimits(): typeof PRODUCTION_BRIEF_UPDATE_LIMITS {
    return PRODUCTION_BRIEF_UPDATE_LIMITS;
}
