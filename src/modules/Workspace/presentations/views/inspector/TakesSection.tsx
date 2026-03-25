import { type ReactElement, useSyncExternalStore } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { cn } from '#/helpers/Styles/cn';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { setCompRegion, selectTake, flattenComp } from '#/modules/Arrangement/useCases/comping';

type TakesSectionProps = {
    trackId: string;
};

export const TakesSection = ({ trackId }: TakesSectionProps): ReactElement | null => {
    const takeLaneState = useSyncExternalStore(
        (cb) => takeLaneStore.subscribe(cb),
        () => takeLaneStore.value
    );

    const lane = takeLaneState?.lanes.find((l) => l.trackId === trackId);
    if (!lane || lane.takes.length === 0) {
        return null;
    }

    const handleSetActive = (takeId: string) => {
        const take = lane.takes.find((t) => t.id === takeId);
        if (!take) {
            return;
        }
        selectTake(trackId, takeId);
        setCompRegion(trackId, {
            takeId,
            startBeat: take.startBeat,
            endBeat: take.endBeat,
        });
    };

    return (
        <div className="pt-2">
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 flex flex-row items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Takes ({lane.takes.length})
                </div>
                <Button variant="ghost" size="xs" onClick={() => flattenComp(trackId)} aria-label="Flatten comp">
                    Flatten
                </Button>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                {lane.takes.map((take) => (
                    <Card
                        key={take.id}
                        className={cn(
                            'flex flex-col justify-center rounded-md shadow-none bg-surface-base border-border/50 p-2 gap-2',
                            take.selected ? 'ring-1 ring-primary/30' : ''
                        )}
                    >
                        <div className="flex items-center justify-between w-full">
                            <div className="min-w-0 flex-1">
                                <span className="text-xs text-foreground font-medium truncate block">{take.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    beat {take.startBeat}–{take.endBeat}
                                </span>
                            </div>
                            {take.selected ? (
                                <span className="text-[10px] font-medium text-primary ml-2 shrink-0">Active</span>
                            ) : null}
                        </div>
                        {!take.selected ? (
                            <Button
                                variant="secondary"
                                size="xs"
                                className="w-full"
                                onClick={() => handleSetActive(take.id)}
                                aria-label={`Set ${take.name} as active take`}
                            >
                                Set Active
                            </Button>
                        ) : null}
                    </Card>
                ))}
            </div>
        </div>
    );
};
