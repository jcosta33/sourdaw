import { type KeyboardEvent, type ReactElement, useId } from 'react';

import { Stack } from '#/components/layout';

import { DawCompactInput } from './DawCompactInput';

type DawMenuInlineEditorProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    autoFocus?: boolean;
};

export const DawMenuInlineEditor = ({
    label,
    value,
    onChange,
    onSubmit,
    onCancel,
    autoFocus = true,
}: DawMenuInlineEditorProps): ReactElement => {
    const inputId = useId();
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.nativeEvent.isComposing) {
            event.stopPropagation();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
        }
    };

    return (
        <Stack gap={1} className="mx-1 my-0.5 rounded bg-surface-raised/80 px-2 py-1.5">
            <label htmlFor={inputId} className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
            </label>
            <DawCompactInput
                id={inputId}
                type="text"
                autoFocus={autoFocus}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onSubmit}
                size="micro"
                className="w-full text-[10px]"
            />
        </Stack>
    );
};
