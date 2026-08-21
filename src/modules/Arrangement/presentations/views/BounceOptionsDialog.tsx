import { type ReactElement, useState } from 'react';

import { DawChooserCard } from '#/components/daw/DawChooserCard';
import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawDialogSection } from '#/components/daw/DawDialogSection';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog';

import { type BounceOptions } from '../../useCases/freezeBounce/bounceTrack';

type BounceTrack = {
    name: string;
};

type BounceOptionsDialogProps = {
    track: BounceTrack;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (options: BounceOptions) => void;
};

const normalizationOptions = ['off', 'protection', 'full'] as const satisfies readonly BounceOptions['normalization'][];
const tailHandlingOptions = ['auto', 'manual', 'off'] as const satisfies readonly BounceOptions['tailHandling'][];

function isNormalization(value: string): value is BounceOptions['normalization'] {
    return normalizationOptions.includes(value as BounceOptions['normalization']);
}

function isTailHandling(value: string): value is BounceOptions['tailHandling'] {
    return tailHandlingOptions.includes(value as BounceOptions['tailHandling']);
}

export const BounceOptionsDialog = ({
    track,
    open,
    onOpenChange,
    onConfirm,
}: BounceOptionsDialogProps): ReactElement => {
    const [options, setOptions] = useState<BounceOptions>({
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'new-track',
    });

    const handleConfirm = () => {
        onConfirm(options);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md p-0 overflow-hidden border-none bg-surface-dialog shadow-2xl">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-bold tracking-tight text-foreground/95">
                        Bounce {track.name}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground/80 mt-1.5 leading-relaxed">
                        Render this track to a high-quality audio clip.
                    </DialogDescription>
                </DialogHeader>

                <DawDialogBody className="p-6 pt-4 space-y-6">
                    <DawDialogSection title="Destination">
                        <Grid cols={2} gap={2}>
                            <DawChooserCard
                                compact
                                title="New Track"
                                description="Create a fresh audio track"
                                active={options.destination === 'new-track'}
                                onClick={() => setOptions({ ...options, destination: 'new-track' })}
                            />
                            <DawChooserCard
                                compact
                                title="Replace"
                                description="In-place replacement"
                                active={options.destination === 'replace'}
                                onClick={() => setOptions({ ...options, destination: 'replace' })}
                            />
                        </Grid>
                    </DawDialogSection>

                    <DawDialogSection title="Signal Chain">
                        <Stack gap={3}>
                            <Row gap={3} as="label" className="cursor-pointer group">
                                <DawCompactCheckbox
                                    checked={options.includeInserts}
                                    onChange={(event) =>
                                        setOptions({ ...options, includeInserts: event.target.checked })
                                    }
                                />
                                <Stack gap={0.5}>
                                    <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                                        Include Inserts
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/60 leading-tight">
                                        Bake all plugins into the audio
                                    </span>
                                </Stack>
                            </Row>

                            <Row gap={3} as="label" className="cursor-pointer group">
                                <DawCompactCheckbox
                                    checked={options.includeSends}
                                    onChange={(event) => setOptions({ ...options, includeSends: event.target.checked })}
                                />
                                <Stack gap={0.5}>
                                    <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                                        Include Sends
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/60 leading-tight">
                                        Capture return effects
                                    </span>
                                </Stack>
                            </Row>

                            <Row gap={3} as="label" className="cursor-pointer group">
                                <DawCompactCheckbox
                                    checked={options.includeAutomation}
                                    onChange={(event) =>
                                        setOptions({ ...options, includeAutomation: event.target.checked })
                                    }
                                />
                                <Stack gap={0.5}>
                                    <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                                        Include Automation
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/60 leading-tight">
                                        Commit volume and pan movements
                                    </span>
                                </Stack>
                            </Row>
                        </Stack>
                    </DawDialogSection>

                    <Grid cols={2} gap={4}>
                        <DawDialogSection title="Normalization">
                            <DawCompactSelect
                                className="w-full bg-surface-inset border border-border/30 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                value={options.normalization}
                                onChange={(event) => {
                                    if (isNormalization(event.target.value)) {
                                        setOptions({ ...options, normalization: event.target.value });
                                    }
                                }}
                            >
                                <option value="off">Off</option>
                                <option value="protection">Peak Protection</option>
                                <option value="full">Full Normalize</option>
                            </DawCompactSelect>
                        </DawDialogSection>

                        <DawDialogSection title="Tail Handling">
                            <DawCompactSelect
                                className="w-full bg-surface-inset border border-border/30 rounded px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                value={options.tailHandling}
                                onChange={(event) => {
                                    if (isTailHandling(event.target.value)) {
                                        setOptions({ ...options, tailHandling: event.target.value });
                                    }
                                }}
                            >
                                <option value="auto">Auto (Detect)</option>
                                <option value="manual">Fixed (5s)</option>
                                <option value="off">None (Strict)</option>
                            </DawCompactSelect>
                        </DawDialogSection>
                    </Grid>
                </DawDialogBody>

                <DawDialogFooter align="end" className="bg-surface-base/80">
                    <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="default" size="sm" onClick={handleConfirm}>
                        Render
                    </Button>
                </DawDialogFooter>
            </DialogContent>
        </Dialog>
    );
};
