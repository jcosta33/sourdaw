import { type ComponentType, type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

type RailBackBarProps = {
    title: string;
    onBack: () => void;
    icon?: ComponentType<{ className?: string }>;
    iconColor?: string;
};

export const RailBackBar = ({ title, onBack, icon: Icon, iconColor }: RailBackBarProps): ReactElement => (
    <Row gap={1} shrink={false} className="h-[34px] border-b border-border/50 bg-surface-overlay px-2 py-1.5">
        <Button
            variant="ghost"
            size="icon-xs"
            onClick={onBack}
            className="h-5 w-5 shrink-0 text-muted-foreground hover:bg-surface-raised hover:text-foreground"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="m15 18-6-6 6-6" />
            </svg>
        </Button>
        <span className="ml-1 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
        </span>
        {Icon ? <Icon className={`size-3.5 shrink-0 ${iconColor ?? 'text-muted-foreground/50'}`} /> : null}
    </Row>
);
