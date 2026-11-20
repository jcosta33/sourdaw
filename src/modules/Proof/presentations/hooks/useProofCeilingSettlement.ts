import { useLayoutEffect, useRef } from 'react';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { proofLimiterCeiling } from '../../useCases/proofParamBridge/proofLimiterCeiling';

export function useProofCeilingSettlement(deviceId: string): (apply: () => void) => void {
    const panelLifetimeRef = useRef<symbol | null>(null);
    useLayoutEffect(() => {
        panelLifetimeRef.current = Symbol();
        return () => {
            panelLifetimeRef.current = null;
        };
    }, [deviceId]);

    function afterCeilingSettlement(apply: () => void): void {
        const settlement = proofLimiterCeiling.settlement(deviceId);
        if (!settlement) {
            apply();
            return;
        }
        const lifetime = panelLifetimeRef.current;
        settlement.done
            .then(() => {
                if (lifetime && panelLifetimeRef.current === lifetime && settlement.ownerIsCurrent()) {
                    // An earlier callback can have released another ceiling while this one waited.
                    return afterCeilingSettlement(apply);
                }
                return undefined;
            })
            .catch((error: unknown) => {
                notifyUser(error instanceof Error ? error.message : 'Proof parameter change failed', 'error');
            });
    }

    return afterCeilingSettlement;
}
