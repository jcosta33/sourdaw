import { type ComponentType, type ReactElement, useEffect, useRef, useState } from 'react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type RailTabBarItem<TId extends string> = {
    id: TId;
    label: string;
    icon?: ComponentType<{ className?: string }>;
};

type RailTabBarProps<TId extends string> = {
    activeId: TId;
    items: RailTabBarItem<TId>[];
    onChange: (id: TId) => void;
    className?: string;
    scrollerClassName?: string;
    buttonClassName?: string;
    size?: 'main' | 'sub';
};

const SIZE_CLASS_NAMES: Record<NonNullable<RailTabBarProps<string>['size']>, string> = {
    main: 'h-7 gap-1 px-2 text-[10px]',
    sub: 'h-6 flex-1 gap-1 text-[10px]',
};

export const RailTabBar = <TId extends string>({
    activeId,
    items,
    onChange,
    className,
    scrollerClassName,
    buttonClassName,
    size = 'main',
}: RailTabBarProps<TId>): ReactElement => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) {
            return undefined;
        }

        const updateScrollState = () => {
            const scrollLeft = element.scrollLeft;
            const overflow = element.scrollWidth - element.clientWidth;
            setCanScrollLeft(scrollLeft > 1);
            setCanScrollRight(overflow > 1 && scrollLeft < overflow - 1);
        };

        requestAnimationFrame(updateScrollState);
        element.addEventListener('scroll', updateScrollState, { passive: true });
        const observer = new ResizeObserver(() => requestAnimationFrame(updateScrollState));
        observer.observe(element);

        return () => {
            element.removeEventListener('scroll', updateScrollState);
            observer.disconnect();
        };
    }, [items.length]);

    return (
        <div className={cn('relative shrink-0', className)}>
            <div ref={scrollRef} className={cn('flex gap-0.5 overflow-x-auto scrollbar-none', scrollerClassName)}>
                {items.map((item) => {
                    const Icon = item.icon;
                    return (
                        <Button
                            key={item.id}
                            variant={activeId === item.id ? 'secondary' : 'ghost'}
                            size="xs"
                            className={cn('shrink-0', SIZE_CLASS_NAMES[size], buttonClassName)}
                            onClick={() => onChange(item.id)}
                        >
                            {Icon ? <Icon className="size-3" /> : null}
                            {item.label}
                        </Button>
                    );
                })}
            </div>

            <Button
                variant="bare"
                size="bare"
                type="button"
                className={cn(
                    'absolute inset-y-0 left-0 z-10 flex w-6 items-center justify-center bg-gradient-to-r from-surface-base/90 to-transparent transition-opacity',
                    canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0'
                )}
                onClick={() => scrollRef.current?.scrollBy({ left: -80, behavior: 'smooth' })}
                aria-label="Scroll tabs left"
                tabIndex={canScrollLeft ? 0 : -1}
            >
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                >
                    <path d="m15 18-6-6 6-6" />
                </svg>
            </Button>

            <Button
                variant="bare"
                size="bare"
                type="button"
                className={cn(
                    'absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center bg-gradient-to-l from-surface-base/90 to-transparent transition-opacity',
                    canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0'
                )}
                onClick={() => scrollRef.current?.scrollBy({ left: 80, behavior: 'smooth' })}
                aria-label="Scroll tabs right"
                tabIndex={canScrollRight ? 0 : -1}
            >
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                >
                    <path d="m9 18 6-6-6-6" />
                </svg>
            </Button>
        </div>
    );
};
