import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

const toneClassNames = {
    default: 'rounded-md border border-border-hairline bg-surface-well p-2 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]',
    framed:
        'rounded-md border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,rgba(255,255,255,0.008)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] [border-bottom-color:rgba(0,0,0,0.3)] [border-left-color:rgba(255,255,255,0.04)] [border-right-color:rgba(0,0,0,0.2)] [border-top-color:rgba(255,255,255,0.05)]',
} as const;

type InsetPanelProps = HTMLAttributes<HTMLDivElement> & {
    tone?: keyof typeof toneClassNames;
};

export const InsetPanel = ({ className, tone = 'default', children, ...props }: InsetPanelProps): ReactElement => (
    <div
        className={cn(toneClassNames[tone], className)}
        {...props}
    >
        {children}
    </div>
);
