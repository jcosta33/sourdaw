import { type ReactElement } from 'react';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

export type MergeResultData = {
    success: boolean;
    tracksAdded: number;
    documentsMerged: number;
    documentsNew: number;
    error?: string;
};

type MergeResultDialogProps = {
    result: MergeResultData;
    onClose: () => void;
};

export const MergeResultDialog = ({ result, onClose }: MergeResultDialogProps): ReactElement => {
    if (!result.success) {
        return (
            <Row justify="center" className="fixed inset-0 z-50 bg-bg-scrim/90 px-4 backdrop-blur-[2px]">
                <DawUtilityPanel className="w-full max-w-sm">
                    <DawHeaderBand
                        className="px-4 py-3"
                        startSlot={<AlertTriangle className="size-3.5 text-[var(--color-state-warning)]" />}
                        title="Merge Failed"
                        titleClassName="text-[11px] text-foreground"
                    />
                    <Stack gap={4} className="px-4 py-4">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            {result.error ?? 'An unknown error occurred during merge.'}
                        </p>
                        <Row align="stretch" justify="end">
                            <Button variant="secondary" size="sm" onClick={onClose}>
                                Close
                            </Button>
                        </Row>
                    </Stack>
                </DawUtilityPanel>
            </Row>
        );
    }

    return (
        <Row justify="center" className="fixed inset-0 z-50 bg-bg-scrim/90 px-4 backdrop-blur-[2px]">
            <DawUtilityPanel className="w-full max-w-sm">
                <DawHeaderBand
                    className="px-4 py-3"
                    startSlot={<CheckCircle2 className="size-3.5 text-[var(--color-state-success)]" />}
                    title="Merge Complete"
                    titleClassName="text-[11px] text-foreground"
                />
                <Stack gap={4} className="px-4 py-4">
                    <Stack gap={2} className="text-sm text-foreground/88">
                        {result.tracksAdded > 0 ? (
                            <p>
                                {result.tracksAdded} new track{result.tracksAdded > 1 ? 's' : ''} added
                            </p>
                        ) : null}
                        {result.documentsMerged > 0 ? (
                            <p>
                                {result.documentsMerged} document{result.documentsMerged > 1 ? 's' : ''} merged
                            </p>
                        ) : null}
                        {result.documentsNew > 0 ? (
                            <p>
                                {result.documentsNew} new document{result.documentsNew > 1 ? 's' : ''} imported
                            </p>
                        ) : null}
                        {result.documentsMerged === 0 && result.documentsNew === 0 ? (
                            <p className="text-muted-foreground">
                                No changes detected. The projects are already in sync.
                            </p>
                        ) : null}
                    </Stack>
                    <Row align="stretch" justify="end">
                        <Button size="sm" onClick={onClose}>
                            Done
                        </Button>
                    </Row>
                </Stack>
            </DawUtilityPanel>
        </Row>
    );
};
