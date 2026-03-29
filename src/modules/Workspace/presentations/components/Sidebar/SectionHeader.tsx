import { type ReactElement } from 'react';

type SectionHeaderProps = {
    label: string;
};

export const SectionHeader = ({ label }: SectionHeaderProps): ReactElement => (
    <div className="flex items-center gap-1.5 px-1 py-0.5 mb-1.5">
        <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
            {label}
        </span>
        <div className="flex-1 h-px bg-border/20" />
    </div>
);
