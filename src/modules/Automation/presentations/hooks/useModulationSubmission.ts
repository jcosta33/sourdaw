import { useEffect, useRef, useState } from 'react';

import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';

type CreationAction = Extract<Parameters<typeof executeUserAppAction>[0], { type: 'addModulator' | 'addMapping' }>;

export function useModulationSubmission(onClose: () => void) {
    const [authority] = useState(captureProjectTransitionAuthority);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const inFlightRef = useRef(false);
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const submit = async (action: CreationAction, hasTarget: () => boolean, isSettled: () => boolean) => {
        if (inFlightRef.current) {
            return;
        }
        if (!authority.isCurrent()) {
            setError('The project changed. Reopen this form in the current project.');
            return;
        }
        inFlightRef.current = true;
        setPending(true);
        setError('');
        const subject = action.type === 'addModulator' ? 'modulator' : 'mapping';
        const available = () => mountedRef.current && authority.isCurrent() && hasTarget();
        let accepted = false;
        let failure = 'The target may be unavailable or the project may have locks';
        try {
            await executeUserAppAction(action, {
                shouldExecute: available,
                shouldCommit: available,
                // Admission precedes the handler's no-op check. A locked dispatch
                // resolves without ever reaching this observer.
                observeMaterializedAction: () => {
                    accepted = action.type === 'addMapping' && isSettled();
                },
                onCommitted: () => {
                    accepted = true;
                },
            });
        } catch (error_) {
            accepted = isAppActionCommittedError(error_);
            failure = error_ instanceof Error ? error_.message : 'The edit failed';
        } finally {
            inFlightRef.current = false;
            setPending(false);
        }
        if (accepted && available() && isSettled()) {
            onClose();
            return;
        }
        setError(`Could not add the ${subject}. ${failure}. Check the target and try again.`);
    };
    return { error, pending, submit };
}
