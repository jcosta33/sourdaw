import { type AppAction } from '#/utils/handlerContract';

type ProductionBriefAdmission = {
    allowsCurrent(): boolean;
};

type ProductionBriefAdmissionGuard = (actions: readonly AppAction[]) => ProductionBriefAdmission;

type ProductionBriefChangeSubscription = (listener: () => void) => () => void;

let guard: ProductionBriefAdmissionGuard | null = null;
let subscribeToBriefChanges: ProductionBriefChangeSubscription | null = null;

/**
 * Command may not import the module that owns the production brief, so
 * `registerCorePorts()` in `src/app/bootstrap.ts` fills the guard and the
 * subscription. Reading either unfilled throws: an admission that answered
 * "allowed" without a guard would let an action past a brief that forbids it.
 */
export const productionBriefAdmissionPort = {
    capture(actions: readonly AppAction[]): ProductionBriefAdmission {
        if (guard === null) {
            throw new Error(
                'productionBriefAdmissionPort.capture: no admission guard is registered; call productionBriefAdmissionPort.setGuard() from registerCorePorts() in src/app/bootstrap.ts'
            );
        }
        return guard(actions);
    },
    setGuard(nextGuard: ProductionBriefAdmissionGuard): void {
        guard = nextGuard;
    },
    /** Calls `listener` whenever the production brief changes, which can change what the guard admits. */
    subscribe(listener: () => void): () => void {
        if (subscribeToBriefChanges === null) {
            throw new Error(
                'productionBriefAdmissionPort.subscribe: no change subscription is registered; call productionBriefAdmissionPort.setSubscription() from registerCorePorts() in src/app/bootstrap.ts'
            );
        }
        return subscribeToBriefChanges(listener);
    },
    setSubscription(nextSubscription: ProductionBriefChangeSubscription): void {
        subscribeToBriefChanges = nextSubscription;
    },
};
