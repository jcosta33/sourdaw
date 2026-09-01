import * as React from 'react';

import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '#/utils/Styles/cn';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    ref?: React.Ref<React.ElementRef<typeof PopoverPrimitive.Content>>;
};

function PopoverContent({ className, align = 'center', sideOffset = 6, ref, ...props }: PopoverContentProps) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={ref}
                align={align}
                sideOffset={sideOffset}
                collisionPadding={12}
                className={cn(
                    'daw-floating-surface z-50 max-h-[min(28rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-1.5rem)] overflow-auto rounded-md p-2 text-popover-foreground outline-none',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 origin-[--radix-popover-content-transform-origin]',
                    className
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverAnchor = PopoverPrimitive.Anchor;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
