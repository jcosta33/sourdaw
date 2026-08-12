import { type AppAction } from '#/utils/handlerContract';

type ProductionBriefAdmissionGuard = (actions: readonly AppAction[]) => boolean;

let guard: ProductionBriefAdmissionGuard = () => true;

export const productionBriefAdmissionPort = {
    allows(actions: readonly AppAction[]): boolean {
        return guard(actions);
    },
    setGuard(nextGuard: ProductionBriefAdmissionGuard): void {
        guard = nextGuard;
    },
};
