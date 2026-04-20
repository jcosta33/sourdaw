/**
 * DisabledFeatureWrapper — wraps children with a disabled state and tooltip
 * when a platform feature is unavailable.
 *
 * When `disabled` is true, the children are rendered with reduced opacity,
 * pointer-events disabled, and wrapped in a tooltip that explains why the
 * feature is unavailable.
 *
 * When `disabled` is false, children render normally with no wrapper overhead.
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip';

type DisabledFeatureWrapperProps = {
    /** Whether the feature is unavailable */
    readonly disabled: boolean;
    /** Explanation shown in the tooltip when disabled */
    readonly reason: string;
    /** The content to wrap */
    readonly children: ReactNode;
    /** Optional extra class names on the wrapper span */
    readonly className?: string;
};

export function DisabledFeatureWrapper({
    disabled,
    reason,
    children,
    className,
}: DisabledFeatureWrapperProps): ReactNode {
    if (!disabled) {
        return children;
    }

    const disabledChild = isValidElement(children)
        ? cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true })
        : children;

    return (
        <TooltipProvider delayDuration={400}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={`inline-flex cursor-not-allowed opacity-50 ${className ?? ''}`}>
                        <span className="pointer-events-none">{disabledChild}</span>
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-center">
                    {reason}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
