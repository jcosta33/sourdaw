import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

/** The question asked once after a hosted provider is saved under Automatic. */
export type HostedBackendQuestion = {
    identity: string;
    providerLabel: string;
};

type HostedBackendQuestionPromptProps = {
    providerLabel: string;
    onKeep: () => void;
    onUse: () => void;
};

export function HostedBackendQuestionPrompt({
    providerLabel,
    onKeep,
    onUse,
}: HostedBackendQuestionPromptProps): ReactElement {
    return (
        <div
            role="group"
            aria-labelledby="hosted-ai-backend-question"
            className="mt-1.5 rounded-md border border-border/50 p-2"
        >
            <p id="hosted-ai-backend-question" className="text-[10px] leading-relaxed">
                Automatic never sends requests to a hosted provider. Use {providerLabel} for AI requests?
            </p>
            <Row gap={1.5} justify="end" className="mt-1.5">
                <Button variant="ghost" size="xs" className="text-[10px]" onClick={onKeep}>
                    Keep Automatic
                </Button>
                <Button size="xs" className="text-[10px]" onClick={onUse}>
                    Use hosted provider
                </Button>
            </Row>
        </div>
    );
}
