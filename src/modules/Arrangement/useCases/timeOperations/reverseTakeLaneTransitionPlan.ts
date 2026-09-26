import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

/**
 * The reversed plan's slot undoes what applying the original did: a plan that
 * restored the lanes reverses into one that retires them again, and back.
 */
export function reverseTakeLaneTransitionPlan(plan: TakeLaneTransitionPlan): TakeLaneTransitionPlan {
    return {
        ...plan,
        appliedEffect: plan.appliedEffect === 'restore' ? 'retire' : 'restore',
    };
}
