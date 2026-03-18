import { type ReactElement, useSyncExternalStore } from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { cn } from '#/helpers/Styles/cn';
import { takeLaneStore } from '#/modules/Track/stores/takeLaneStore';
import { setCompRegion, selectTake, flattenComp } from '../../../useCases/workspaceViewActions';

export type TakesSectionProps = {
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
        <>
            <Separator />
            <section>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Takes ({lane.takes.length})
                    </h3>
                    <Button variant="ghost" size="xs" onClick={() => flattenComp(trackId)} aria-label="Flatten comp">
                        Flatten
                    </Button>
                </div>
                <div className="space-y-1">
                    {lane.takes.map((take) => (
                        <div
                            key={take.id}
                            className={cn(
                                'flex items-center justify-between rounded px-2 py-1.5',
                                take.selected ? 'bg-primary/15 ring-1 ring-primary/30' : 'bg-surface-overlay'
                            )}
                        >
                            <div className="min-w-0 flex-1">
                                <span className="text-xs text-foreground truncate block">{take.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    beat {take.startBeat}–{take.endBeat}
                                </span>
                            </div>
                            {!take.selected && (
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => handleSetActive(take.id)}
                                    aria-label={`Set ${take.name} as active take`}
                                >
                                    Set Active
                                </Button>
                            )}
                            {take.selected && <span className="text-[10px] font-medium text-primary">Active</span>}
                        </div>
                    ))}
                </div>
            </section>
        </>
    );
};
