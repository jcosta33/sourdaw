import { useEffect, useState } from 'react';

import { type ConfirmPayload } from '../../events/WorkspaceEvents';
import { onConfirmation } from '../../useCases/onConfirmation';

type UseConfirmationDialogOutput = {
    pending: ConfirmPayload | null;
    confirm: () => void;
    cancel: () => void;
};

export function useConfirmationDialog(): UseConfirmationDialogOutput {
    const [pending, setPending] = useState<ConfirmPayload | null>(null);

    useEffect(() => {
        return onConfirmation((payload) => {
            setPending((current) => {
                if (current) {
                    current.resolve(false);
                }
                return payload;
            });
        });
    }, []);

    const confirm = (): void => {
        pending?.resolve(true);
        setPending(null);
    };

    const cancel = (): void => {
        pending?.resolve(false);
        setPending(null);
    };

    return { pending, confirm, cancel };
}
