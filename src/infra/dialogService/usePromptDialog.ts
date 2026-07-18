import { useEffect, useState } from 'react';

import { type PromptPayload } from '#/utils/Notification/notificationEventBus';

import { onPrompt } from './onPrompt';

type UsePromptDialogOutput = {
    pending: PromptPayload | null;
    value: string;
    setValue: (value: string) => void;
    submit: () => void;
    cancel: () => void;
};

export function usePromptDialog(): UsePromptDialogOutput {
    const [pending, setPending] = useState<PromptPayload | null>(null);
    const [value, setValue] = useState('');

    useEffect(() => {
        return onPrompt((payload) => {
            setPending((current) => {
                if (current) {
                    current.resolve(null);
                }
                return payload;
            });
            setValue(payload.initialValue ?? '');
        });
    }, []);

    const submit = (): void => {
        const trimmed = value.trim();
        pending?.resolve(trimmed ? trimmed : null);
        setPending(null);
        setValue('');
    };

    const cancel = (): void => {
        pending?.resolve(null);
        setPending(null);
        setValue('');
    };

    return { pending, value, setValue, submit, cancel };
}
