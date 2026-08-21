import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Row, Stack } from '#/components/layout';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { useStore } from '#/infra/store/useStore';

import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadModel } from '../../useCases/downloadModel';
import { KOKORO_MODEL_ENTRY } from '../../useCases/initBrowserAi';
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

const DDSP_UNAVAILABLE_DESCRIPTION = 'TF.js worker unavailable in this build';
const DDSP_UNAVAILABLE_LABEL = 'DDSP browser rendering is not available in this build';

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
            <Row gap={2}>
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
            </Row>
        );
    }

    if (status === 'ready') {
        return (
            <Row gap={2}>
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
            </Row>
        );
    }

    if (status === 'error') {
        return (
            <Row gap={2}>
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
            </Row>
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
    const instruments = registryInstruments.length > 0 ? registryInstruments : DDSP_INSTRUMENT_CATALOG;

    const totalUsed = registry.storageUsedBytes;
    const limitBytes = 2 * 1024 * 1024 * 1024;
    const usagePercent = Math.min(100, (totalUsed / limitBytes) * 100);
    const nearLimit = usagePercent > 80;

    return (
        <Stack gap={3} className="p-3" aria-label="AI Model Manager">
            {/* Storage */}
            <DawUtilitySection title="Storage">
                <Stack gap={1.5}>
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
                </Stack>
            </DawUtilitySection>

            {MODEL_RELEASE_ADMISSION.ddsp ? (
                <DawUtilitySection title="DDSP Instruments" detail="Monophonic synthesis · Google Research">
                    <Stack gap={0.5}>
                        {instruments.map((instrument) => {
                            const status = 'status' in instrument ? instrument.status : 'error';
                            const description =
                                status === 'ready' ? 'CDN · ~15 MB · cached by browser' : DDSP_UNAVAILABLE_DESCRIPTION;
                            return (
                                <DawPickerRow
                                    key={instrument.id}
                                    heading={instrument.name}
                                    description={description}
                                    endSlot={
                                        status === 'ready' ? (
                                            <DawMicroBadge
                                                tone="success"
                                                aria-label={`${instrument.name} cached and ready`}
                                            >
                                                ✓ Cached
                                            </DawMicroBadge>
                                        ) : (
                                            <DawMicroBadge
                                                tone="danger"
                                                aria-label={`${instrument.name} unavailable: ${DDSP_UNAVAILABLE_LABEL}`}
                                            >
                                                Unavailable
                                            </DawMicroBadge>
                                        )
                                    }
                                />
                            );
                        })}
                    </Stack>
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
            <Stack
                as="section"
                gap={0.5}
                className="text-[9px] text-muted-foreground/55 border-t border-border/20 pt-2"
                aria-labelledby="credits-heading"
            >
                <p id="credits-heading" className="font-medium text-muted-foreground/70 mb-1">
                    AI Model Credits
                </p>
                {MODEL_RELEASE_ADMISSION.kokoro ? <p>Kokoro TTS: hexgrad. Apache 2.0.</p> : null}
            </Stack>
        </Stack>
    );
}
