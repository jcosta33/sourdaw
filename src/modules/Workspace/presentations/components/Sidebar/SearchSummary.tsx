import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type SearchSummaryProps = HTMLAttributes<HTMLDivElement> & {
    count: number;
    query: string;
};

export const SearchSummary = ({ count, query, className, ...props }: SearchSummaryProps): ReactElement => (
    <div
        className={cn(
            'px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground/70',
            className
        )}
        {...props}
    >
        {count} result{count !== 1 ? 's' : ''} for &quot;{query}&quot;
    </div>
);
