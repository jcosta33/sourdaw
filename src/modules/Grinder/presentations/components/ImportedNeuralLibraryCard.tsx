import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';

type ImportedNeuralLibraryCardProps = {
    entry: GrinderImportedNeuralModel;
    selected: boolean;
    on_select: (entry: GrinderImportedNeuralModel) => void;
    on_export: (entry: GrinderImportedNeuralModel) => void;
    on_remove: (entry: GrinderImportedNeuralModel) => void;
};

export function ImportedNeuralLibraryCard({
    entry,
    selected,
    on_select,
    on_export,
    on_remove,
}: ImportedNeuralLibraryCardProps): ReactElement {
    const has_library_source = Boolean(entry.sourceFileText);

    return (
        <div
            className={`rounded-[18px] border px-4 py-3 text-left ${
                selected
                    ? 'border-[var(--color-accent-cyan)]/60 bg-[var(--color-accent-cyan)]/12'
                    : 'border-white/8 bg-bg-well'
            }`}
        >
            <Row align="start" justify="between" gap={3}>
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    aria-pressed={selected}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => on_select(entry)}
                >
                    <Row justify="between" gap={3}>
                        <span className="text-sm font-medium text-text-primary">{entry.name}</span>
                        <span className="text-dense uppercase tracking-[0.18em] text-text-primary">
                            {entry.profile.sourceSampleRate} Hz
                        </span>
                    </Row>
                    <div className="mt-1 text-xs text-text-primary">{entry.family}</div>
                    <div className="mt-2 text-compact text-text-primary">{entry.description}</div>
                </Button>
                <Row align="stretch" gap={2} shrink={false}>
                    {has_library_source ? (
                        <>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                className="rounded-[12px] border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-2 py-1 text-dense uppercase tracking-[0.16em] text-[var(--color-accent-cyan)]"
                                onClick={() => on_export(entry)}
                            >
                                Export NAM
                            </Button>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                className="rounded-[12px] border border-white/12 bg-surface-default/90 px-2 py-1 text-dense uppercase tracking-[0.16em] text-text-primary"
                                onClick={() => on_remove(entry)}
                            >
                                Remove capture
                            </Button>
                        </>
                    ) : (
                        <span className="rounded-[12px] border border-white/10 bg-surface-default/90 px-2 py-1 text-dense uppercase tracking-[0.16em] text-text-primary">
                            Patch only
                        </span>
                    )}
                </Row>
            </Row>
        </div>
    );
}
