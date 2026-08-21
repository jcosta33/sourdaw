import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { useStore } from '#/infra/store/useStore';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../../useCases/downloadDdspInstrument';
import { downloadModel } from '../../useCases/downloadModel';
import { KOKORO_MODEL_ENTRY } from '../../useCases/initBrowserAi';
import { removeDdspInstrument } from '../../useCases/removeDdspInstrument';
import { removeModel } from '../../useCases/removeModel';

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type ModelActionProps = {
    id: string;
    name: string;
    family: string;
    url: string;
    sizeBytes: number;
    sha256?: string;
    status: string;
    downloadProgress: number;
};

function ModelAction({
    id,
    name,
    family,
    url,
    sizeBytes,
    sha256,
    status,
    downloadProgress,
}: ModelActionProps): ReactElement {
    const handleDownload = (): void => {
        void downloadModel({ modelId: id, family, url, sizeBytes, sha256 });
    };
    const handleRemove = (): void => {
        // Surface a failed delete instead of letting the rejection vanish into a
        // bare void; without this a failed OPFS delete leaves the model showing
        // "Ready" with no feedback.
        void removeModel({ modelId: id, family }).catch((error: unknown) => {
            logger.error(new Error(`[BrowserAi] Failed to remove model "${id}"`, { cause: error }));
        });
    };

    if (status === 'downloading') {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="w-12 h-1 bg-border/40 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(downloadProgress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Downloading ${name}: ${Math.round(downloadProgress * 100)}%`}
                >
                    <div
                        className="h-full bg-[var(--color-accent-orange)] transition-all"
                        style={{ width: `${Math.round(downloadProgress * 100)}%` }}
                    />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums">
                    {Math.round(downloadProgress * 100)}%
                </span>
            </div>
        );
    }

    if (status === 'ready') {
        return (
            <div className="flex items-center gap-2">
                <DawMicroBadge tone="success" aria-label={`${name} downloaded and ready`}>
                    ✓ Ready
                </DawMicroBadge>
                <button
                    type="button"
                    onClick={handleRemove}
                    className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label={`Remove ${name} from storage`}
                >
                    Remove
                </button>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="flex items-center gap-2">
                <DawMicroBadge tone="danger" aria-label={`${name} download failed`}>
                    Failed
                </DawMicroBadge>
                <button
                    type="button"
                    onClick={handleDownload}
                    className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Retry downloading ${name}`}
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={handleDownload}
            className="px-2 py-0.5 text-[9px] border border-border/50 rounded hover:bg-surface-hover transition-colors text-muted-foreground hover:text-foreground"
            aria-label={`Download ${name} (${formatBytes(sizeBytes)})`}
        >
            Download
        </button>
    );
}

type AdmittedDdspInstrument = DdspInstrument & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

function DdspInstrumentAction({ instrument }: { instrument: AdmittedDdspInstrument }): ReactElement {
    const handleDownload = (): void => {
        const download = downloadDdspInstrument as (candidate: AdmittedDdspInstrument) => Promise<void>;
        void download(instrument).catch((error: unknown) => {
            logger.error(new Error('[BrowserAi] Failed to download DDSP instrument', { cause: error }));
        });
    };
    const handleRemove = (): void => {
        const remove = removeDdspInstrument as (candidate: AdmittedDdspInstrument) => Promise<void>;
        void remove(instrument).catch((error: unknown) => {
            logger.error(new Error('[BrowserAi] Failed to remove DDSP instrument', { cause: error }));
        });
    };

    if (instrument.status === 'ready') {
        return (
            <div className="flex items-center gap-2">
                <DawMicroBadge tone="success" aria-label={`${instrument.name} stored and verified`}>
                    ✓ Ready
                </DawMicroBadge>
                <button
                    type="button"
                    onClick={handleRemove}
                    className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label={`Remove ${instrument.name} from storage`}
                >
                    Remove
                </button>
            </div>
        );
    }

    if (instrument.status === 'downloading') {
        return (
            <div className="flex items-center gap-2" aria-label={`Downloading ${instrument.name}`}>
                <div
                    className="w-12 h-1 bg-border/40 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(instrument.downloadProgress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Downloading ${instrument.name}: ${Math.round(instrument.downloadProgress * 100)}%`}
                >
                    <div
                        className="h-full bg-[var(--color-accent-orange)] transition-all"
                        style={{ width: `${Math.round(instrument.downloadProgress * 100)}%` }}
                    />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums">
                    {Math.round(instrument.downloadProgress * 100)}%
                </span>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={handleDownload}
            className="px-2 py-0.5 text-[9px] border border-border/50 rounded hover:bg-surface-hover transition-colors text-muted-foreground hover:text-foreground"
            aria-label={`Download ${instrument.name} from Magenta`}
        >
            Download
        </button>
    );
}

/** Model manager panel showing all downloadable AI models and their storage status */
export function ModelManagerPanel(): ReactElement {
    const defaultRegistry = {
        ddspInstruments: [],
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    };
    const registry = useStore(modelRegistryStore, defaultRegistry);

    const kokoroStatus = registry.kokoroModel?.status ?? 'not-downloaded';
    const kokoroProgress = registry.kokoroModel?.downloadProgress ?? 0;
    // DDSP instruments: use registry status when available, fall back to static catalog
    const registryInstruments = registry.ddspInstruments;
    const instruments: AdmittedDdspInstrument[] =
        registryInstruments.length > 0
            ? (registryInstruments as AdmittedDdspInstrument[])
            : DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
                  ...instrument,
                  // Every catalog entry is backed by the admitted artifact manifest; make that
                  // contract explicit before handing it to a user-triggered storage use case.
                  artifactVersion: instrument.artifactVersion!,
                  artifacts: instrument.artifacts!,
                  status: 'not-downloaded' as const,
                  downloadProgress: 0,
              }));

    const totalUsed = registry.storageUsedBytes;
    const limitBytes = 2 * 1024 * 1024 * 1024;
    const usagePercent = Math.min(100, (totalUsed / limitBytes) * 100);
    const nearLimit = usagePercent > 80;

    return (
        <div className="flex flex-col gap-3 p-3" aria-label="AI Model Manager">
            {/* Storage */}
            <DawUtilitySection title="Storage">
                <div className="space-y-1.5">
                    <div
                        className="w-full h-1 bg-border/40 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuenow={Math.round(usagePercent)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Storage used: ${Math.round(usagePercent)}% of 2 GB`}
                    >
                        <div
                            className={`h-full transition-all ${nearLimit ? 'bg-[var(--color-accent-orange)]' : 'bg-[var(--color-accent-blue)]'}`}
                            style={{ width: `${usagePercent}%` }}
                        />
                    </div>
                    <DawReadoutRow
                        label="Used"
                        value={formatBytes(totalUsed)}
                        valueClassName={nearLimit ? 'text-[var(--color-accent-orange)]' : undefined}
                    />
                    <DawReadoutRow label="Limit" value={formatBytes(limitBytes)} />
                </div>
            </DawUtilitySection>

            {MODEL_RELEASE_ADMISSION.ddsp ? (
                <DawUtilitySection title="DDSP Instruments" detail="Monophonic synthesis · Google Research">
                    <div className="space-y-0.5">
                        {instruments.map((instrument) => {
                            const description =
                                instrument.status === 'ready'
                                    ? `Magenta · ${formatBytes(instrument.sizeBytes)} · verified OPFS`
                                    : `Magenta direct download · ${formatBytes(instrument.sizeBytes)}`;
                            return (
                                <DawPickerRow
                                    key={instrument.id}
                                    heading={instrument.name}
                                    description={description}
                                    endSlot={<DdspInstrumentAction instrument={instrument} />}
                                />
                            );
                        })}
                    </div>
                </DawUtilitySection>
            ) : null}

            {MODEL_RELEASE_ADMISSION.kokoro ? (
                <DawUtilitySection title="Kokoro TTS (82M)" detail="Vocal scratch tracks · Apache 2.0 · hexgrad">
                    <DawPickerRow
                        heading="Kokoro-82M (q8f16)"
                        description={`21 voices · ${formatBytes(KOKORO_MODEL_ENTRY.sizeBytes)}`}
                        endSlot={
                            <ModelAction
                                id={KOKORO_MODEL_ENTRY.id}
                                name="Kokoro-82M (q8f16)"
                                family={KOKORO_MODEL_ENTRY.family}
                                url={KOKORO_MODEL_ENTRY.url}
                                sizeBytes={KOKORO_MODEL_ENTRY.sizeBytes}
                                sha256={KOKORO_MODEL_ENTRY.sha256}
                                status={kokoroStatus}
                                downloadProgress={kokoroProgress}
                            />
                        }
                    />
                </DawUtilitySection>
            ) : null}

            {/* Attribution */}
            <section
                aria-labelledby="credits-heading"
                className="text-[9px] text-muted-foreground/55 border-t border-border/20 pt-2 space-y-0.5"
            >
                <p id="credits-heading" className="font-medium text-muted-foreground/70 mb-1">
                    AI Model Credits
                </p>
                {MODEL_RELEASE_ADMISSION.kokoro ? <p>Kokoro TTS: hexgrad. Apache 2.0.</p> : null}
            </section>
        </div>
    );
}
