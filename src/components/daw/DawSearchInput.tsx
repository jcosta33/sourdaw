import { type ComponentProps, type KeyboardEvent, type ReactElement } from 'react';

import { Search, X } from 'lucide-react';

import { cn } from '#/utils/Styles/cn';

export type DawSearchInputProps = Omit<ComponentProps<'input'>, 'size' | 'value' | 'onChange'> & {
    value: string;
    onChange: (value: string) => void;
    onClear?: () => void;
    size?: 'micro' | 'sm';
    variant?: 'default' | 'ghost';
    containerClassName?: string;
    inputClassName?: string;
};

const SIZE_CONTAINER_CLASS: Record<NonNullable<DawSearchInputProps['size']>, string> = {
    sm: 'h-7 gap-1.5 px-2',
    micro: 'h-6 gap-1 px-1.5',
};

const SIZE_TEXT_CLASS: Record<NonNullable<DawSearchInputProps['size']>, string> = {
    sm: 'text-compact',
    micro: 'text-dense',
};

const SIZE_ICON_CLASS: Record<NonNullable<DawSearchInputProps['size']>, string> = {
    sm: 'size-3.5',
    micro: 'size-3',
};

const VARIANT_CLASS: Record<NonNullable<DawSearchInputProps['variant']>, string> = {
    default: 'rounded border border-border/40 bg-surface-inset shadow-none focus-within:border-ring',
    ghost: 'bg-transparent border-transparent',
};

export const DawSearchInput = ({
    value,
    onChange,
    onClear,
    size = 'sm',
    variant = 'default',
    containerClassName,
    inputClassName,
    className,
    type = 'search',
    onKeyDown,
    ...props
}: DawSearchInputProps): ReactElement => {
    const handleClear = () => {
        onChange('');
        onClear?.();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape' && value) {
            event.stopPropagation();
            event.preventDefault();
            handleClear();
        }
        onKeyDown?.(event);
    };

    return (
        <div
            className={cn(
                'relative flex items-center w-full transition-colors focus-within:ring-1 focus-within:ring-ring',
                VARIANT_CLASS[variant],
                SIZE_CONTAINER_CLASS[size],
                containerClassName,
                className
            )}
        >
            <Search className={cn('shrink-0 text-muted-foreground/55', SIZE_ICON_CLASS[size])} aria-hidden="true" />
            <input
                type={type}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                className={cn(
                    'min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/45 [&::-webkit-search-cancel-button]:hidden',
                    SIZE_TEXT_CLASS[size],
                    inputClassName
                )}
                {...props}
            />
            {value.length > 0 && (
                <button
                    type="button"
                    onClick={handleClear}
                    aria-label="Clear search"
                    className="shrink-0 rounded p-0.5 text-muted-foreground/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <X className="size-3" aria-hidden="true" />
                </button>
            )}
        </div>
    );
};
