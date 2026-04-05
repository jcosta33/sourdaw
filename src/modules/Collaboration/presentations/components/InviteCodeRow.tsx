import { type ReactElement } from 'react';

import { Check, Copy } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { cn } from '#/helpers/Styles/cn';

type InviteCodeRowProps = {
    value: string;
    copied: boolean;
    onCopy: () => void;
    className?: string;
};

export const InviteCodeRow = ({ value, copied, onCopy, className }: InviteCodeRowProps): ReactElement => (
    <div
        className={cn(
            'flex items-center gap-1.5 rounded-md border border-white/8 bg-black/20 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
            className
        )}
    >
        <code className="min-w-0 flex-1 truncate text-[9px] font-mono text-foreground/90">
            {value.length > 40 ? `${value.slice(0, 40)}...` : value}
        </code>
        <Button variant="ghost" size="icon-xs" onClick={onCopy} className="shrink-0">
            {copied ? <Check className="size-3 text-[var(--color-state-success)]" /> : <Copy className="size-3" />}
        </Button>
    </div>
);
