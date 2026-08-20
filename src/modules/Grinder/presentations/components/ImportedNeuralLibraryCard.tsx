import { type ReactElement } from 'react';

import { Row } from '#/components/layout';

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
                    : 'border-white/8 bg-black/20'
            }`}
        >
            <Row align="start" justify="between" gap={3}>
                <button
                    type="button"
                    aria-pressed={selected}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => on_select(entry)}
                >
                    <Row justify="between" gap={3}>
                        <span className="text-sm font-medium text-white/88">{entry.name}</span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-white/34">
                            {entry.profile.sourceSampleRate} Hz
                        </span>
                    </Row>
                    <div className="mt-1 text-xs text-white/44">{entry.family}</div>
                    <div className="mt-2 text-[11px] text-white/34">{entry.description}</div>
                </button>
                <Row align="stretch" gap={2} shrink={false}>
                    {has_library_source ? (
                        <>
                            <button
                                type="button"
                                className="rounded-[12px] border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--color-accent-cyan)]"
                                onClick={() => on_export(entry)}
                            >
                                Export NAM
                            </button>
                            <button
                                type="button"
                                className="rounded-[12px] border border-white/12 bg-black/24 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/58"
                                onClick={() => on_remove(entry)}
                            >
                                Remove capture
                            </button>
                        </>
                    ) : (
                        <span className="rounded-[12px] border border-white/10 bg-black/18 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
                            Patch only
                        </span>
                    )}
                </Row>
            </Row>
        </div>
    );
}
