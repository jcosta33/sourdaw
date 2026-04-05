import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawPluginSectionCardProps = HTMLAttributes<HTMLElement> & {
    title: ReactNode;
    detail?: ReactNode;
    detailMode?: 'hidden' | 'badge';
    titleClassName?: string;
    detailClassName?: string;
    children: ReactNode;
};

export const DawPluginSectionCard = ({
    title,
    detail,
    detailMode = 'hidden',
    className,
    titleClassName,
    detailClassName,
    children,
    ...props
}: DawPluginSectionCardProps): ReactElement => (
    <section className={cn('flex flex-col gap-3 p-3', className)} {...props}>
        {detailMode === 'badge' ? (
            <div className="flex items-center justify-between gap-2">
                <div className={cn('text-[8px] font-semibold uppercase tracking-[0.24em]', titleClassName)}>
                    {title}
                </div>
                {detail ? <div className={detailClassName}>{detail}</div> : null}
            </div>
        ) : (
            <div className="space-y-1">
                <div className={cn('text-[8px] font-semibold uppercase tracking-[0.24em]', titleClassName)}>
                    {title}
                </div>
                {detail ? <span className="sr-only">{detail}</span> : null}
            </div>
        )}
        {children}
    </section>
);
