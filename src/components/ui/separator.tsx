import { type ComponentProps } from 'react';
import { Separator as SeparatorPrimitive } from 'radix-ui';

import { cn } from '#/helpers/Styles/cn';

function Separator({
    className,
    orientation = 'horizontal',
    decorative = true,
    ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
    return (
        <SeparatorPrimitive.Root
            data-slot="separator"
            decorative={decorative}
            orientation={orientation}
            className={cn(
                'shrink-0 opacity-90 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
                'data-[orientation=horizontal]:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),rgba(0,0,0,0.22),transparent)]',
                'data-[orientation=vertical]:bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.08),rgba(0,0,0,0.22),transparent)]',
                className
            )}
            {...props}
        />
    );
}

export { Separator };
