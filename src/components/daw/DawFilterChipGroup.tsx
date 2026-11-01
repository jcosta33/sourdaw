import { type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

export type DawFilterChipOption<Value extends string> = {
    value: Value;
    label: string;
    icon?: ReactNode;
    /** Classes applied while this chip is the selected one. */
    activeClassName?: string;
};

type DawFilterChipGroupProps<Value extends string> = {
    label: string;
    options: readonly DawFilterChipOption<Value>[];
    value: Value;
    onValueChange: (value: Value) => void;
    className?: string;
};

const ARROW_STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
};

const targetIndexForKey = (key: string, currentIndex: number, count: number): number | undefined => {
    if (key === 'Home') {
        return 0;
    }
    if (key === 'End') {
        return count - 1;
    }
    const step = ARROW_STEPS[key];
    if (step === undefined) {
        return undefined;
    }
    return (currentIndex + step + count) % count;
};

// A single-select filter: WAI-ARIA radio group with a roving tab stop. Arrow keys move the
// selection and focus together, Home and End jump to the ends.
export const DawFilterChipGroup = <Value extends string>({
    label,
    options,
    value,
    onValueChange,
    className,
}: DawFilterChipGroupProps<Value>): ReactElement => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    const tabStopIndex = Math.max(0, selectedIndex);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (options.length === 0) {
            return;
        }
        const nextIndex = targetIndexForKey(event.key, tabStopIndex, options.length);
        const next = nextIndex === undefined ? undefined : options[nextIndex];
        if (nextIndex === undefined || next === undefined) {
            return;
        }
        event.preventDefault();
        onValueChange(next.value);
        event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus();
    };

    return (
        <Row
            role="radiogroup"
            aria-label={label}
            align="stretch"
            wrap
            gap={1.5}
            className={className}
            onKeyDown={handleKeyDown}
        >
            {options.map((option, index) => {
                const isActive = index === selectedIndex;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        tabIndex={index === tabStopIndex ? 0 : -1}
                        onClick={() => onValueChange(option.value)}
                        className={cn(
                            'flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-border-focus/70',
                            isActive
                                ? option.activeClassName
                                : 'border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
                        )}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </Row>
    );
};
