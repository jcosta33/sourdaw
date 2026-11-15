import { type AppAction } from '#/utils/handlerContract';

type ProductionBriefAdmission = {
    allowsCurrent(): boolean;
};

type ProductionBriefAdmissionGuard = (actions: readonly AppAction[]) => ProductionBriefAdmission;

type ProductionBriefChangeSubscription = (listener: () => void) => () => void;

let guard: ProductionBriefAdmissionGuard = () => ({ allowsCurrent: () => true });
let subscribeToBriefChanges: ProductionBriefChangeSubscription = () => () => undefined;

export const productionBriefAdmissionPort = {
    capture(actions: readonly AppAction[]): ProductionBriefAdmission {
        return guard(actions);
    },
    setGuard(nextGuard: ProductionBriefAdmissionGuard): void {
        guard = nextGuard;
    },
    /** Calls `listener` whenever the production brief changes, which can change what the guard admits. */
    subscribe(listener: () => void): () => void {
        return subscribeToBriefChanges(listener);
    },
    setSubscription(nextSubscription: ProductionBriefChangeSubscription): void {
        subscribeToBriefChanges = nextSubscription;
    },
};
