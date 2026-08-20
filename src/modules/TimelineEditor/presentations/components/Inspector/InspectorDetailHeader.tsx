import { type ReactElement, type ReactNode } from 'react';

import { ChevronRight } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

type InspectorDetailHeaderProps = {
    title: ReactNode;
    onBack: () => void;
    backLabel: string;
    actions?: ReactNode;
};

export const InspectorDetailHeader = ({
    title,
    onBack,
    backLabel,
    actions,
}: InspectorDetailHeaderProps): ReactElement => (
    <Row
        justify="between"
        gap={3}
        className="-mx-3 -mt-3 mb-1 border-b border-black/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,rgba(255,255,255,0.005)_100%)] px-3 py-2 [border-top:1px_solid_rgba(255,255,255,0.04)]"
    >
        <Row gap={1.5}>
            <Button
                variant="ghost"
                size="icon-xs"
                className="hover:bg-surface-raised"
                onClick={onBack}
                aria-label={backLabel}
            >
                <ChevronRight className="size-3 rotate-180" />
            </Button>
            <div className="min-w-0 flex-1">{title}</div>
        </Row>
        {actions}
    </Row>
);
