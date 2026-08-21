import { type AppAction } from '#/utils/handlerContract';

type ProductionBriefAdmission = {
    allowsCurrent(): boolean;
};

type ProductionBriefAdmissionGuard = (actions: readonly AppAction[]) => ProductionBriefAdmission;

let guard: ProductionBriefAdmissionGuard = () => ({ allowsCurrent: () => true });

export const productionBriefAdmissionPort = {
    capture(actions: readonly AppAction[]): ProductionBriefAdmission {
        return guard(actions);
    },
    setGuard(nextGuard: ProductionBriefAdmissionGuard): void {
        guard = nextGuard;
    },
};
