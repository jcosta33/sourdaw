import { type ReactElement } from 'react';

import { Button } from '#/components/ui/button';

type BriefReadingChoice = {
    id: string;
    name: string;
    descriptors: readonly string[];
    planLines: readonly string[];
};

type BriefReadingChoicesProps = {
    readings: readonly BriefReadingChoice[];
    onChoose: (readingId: string) => void;
};

/** One group per reading of an ambiguous brief: the plan it stands for, and the button that runs exactly that plan. */
export const BriefReadingChoices = ({ readings, onChoose }: BriefReadingChoicesProps): ReactElement | null => {
    if (readings.length === 0) {
        return null;
    }
    return (
        <>
            {readings.map((reading) => (
                <div
                    key={reading.id}
                    role="group"
                    aria-label={reading.name}
                    className="flex w-full flex-col items-start gap-1 border-t border-border/30 pt-1.5"
                >
                    <ul className="list-disc pl-4 text-[10px] text-muted-foreground">
                        {reading.planLines.map((line, position) => (
                            <li key={`${String(position)}:${line}`}>{line}</li>
                        ))}
                    </ul>
                    <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => onChoose(reading.id)}
                        aria-label={`Plan reading: ${reading.name}`}
                        className="h-7 gap-1.5 text-[11px]"
                    >
                        {reading.name} <span className="opacity-60">{reading.descriptors.join(', ')}</span>
                    </Button>
                </div>
            ))}
        </>
    );
};
