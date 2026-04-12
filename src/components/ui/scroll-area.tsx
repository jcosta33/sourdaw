import { type ComponentProps } from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';

import { cn } from '#/utils/Styles/cn';

function ScrollArea({ className, children, ...props }: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
    return (
        <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative min-h-0', className)} {...props}>
            <ScrollAreaPrimitive.Viewport
                data-slot="scroll-area-viewport"
                className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:block!"
            >
                {children}
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
}

function ScrollBar({
    className,
    orientation = 'vertical',
    ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
    return (
        <ScrollAreaPrimitive.ScrollAreaScrollbar
            data-slot="scroll-area-scrollbar"
            orientation={orientation}
            className={cn(
                'flex touch-none p-px transition-colors select-none',
                orientation === 'vertical' && 'h-full w-1.5 border-l border-l-transparent',
                orientation === 'horizontal' && 'h-1.5 flex-col border-t border-t-transparent',
                className
            )}
            {...props}
        >
            <ScrollAreaPrimitive.ScrollAreaThumb
                data-slot="scroll-area-thumb"
                className={cn(
                    'relative flex-1 rounded-full bg-white/[0.08] transition-[background,opacity]',
                    'hover:bg-white/[0.12] active:bg-white/[0.16]'
                )}
            />
        </ScrollAreaPrimitive.ScrollAreaScrollbar>
    );
}

export { ScrollArea, ScrollBar };
