import { type ComponentPropsWithRef, type ReactElement } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

/**
 * `ComponentPropsWithRef` rather than `HTMLAttributes` so callers can hold a ref to
 * the panel — a panel used as a `role="dialog"` needs one to move focus into itself
 * on open. In React 19 `ref` is an ordinary prop, so it rides `...props` to the div.
 */
type DawUtilityPanelProps = ComponentPropsWithRef<'div'>;

export const DawUtilityPanel = ({ className, children, ...props }: DawUtilityPanelProps): ReactElement => (
    <Stack className={cn('daw-floating-surface overflow-hidden rounded-lg', className)} {...props}>
        {children}
    </Stack>
);
