import { type ReactElement, useId, useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { type AnswerEvidenceEntry } from '../../models/PlanningOutcome';

type AnswerEvidenceDisclosureProps = {
    evidence: readonly AnswerEvidenceEntry[];
};

/** Collapsed-by-default list of the tool receipts an answer rests on. */
export const AnswerEvidenceDisclosure = ({ evidence }: AnswerEvidenceDisclosureProps): ReactElement | null => {
    const [expanded, setExpanded] = useState(false);
    const regionId = useId();

    if (evidence.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 w-full border-t border-border/30 pt-1.5">
            <Button
                variant="bare"
                size="bare"
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-controls={regionId}
                className="text-left"
            >
                <Row gap={1} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
                    <span className="font-medium">Evidence</span>
                    <span className="opacity-60">{`(${String(evidence.length)})`}</span>
                </Row>
            </Button>
            {expanded ? (
                <ul
                    id={regionId}
                    aria-label="Evidence"
                    className="mt-1 space-y-1 rounded border border-border/20 bg-surface-inset/50 px-2 py-1.5 text-[10px] text-muted-foreground"
                >
                    {evidence.map((entry) => (
                        <li key={entry.callId}>
                            <span className="font-medium text-foreground">{entry.toolName}</span>
                            {`: ${entry.summary}`}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
};
