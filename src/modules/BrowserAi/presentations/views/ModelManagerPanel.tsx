import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { useStore } from '#/infra/store/useStore';

import { type DiffSingerVoicebank } from '../../models/BrowserModel';
import {
    DDSP_INSTRUMENT_CATALOG,
    NSF_HIFIGAN_URL,
    NSF_HIFIGAN_SIZE_BYTES,
    KOKORO_MODEL_URL,
    KOKORO_MODEL_SIZE_BYTES,
} from '../../models/ddspInstrumentCatalog';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadModel } from '../../useCases/downloadModel';
import { removeModel } from '../../useCases/removeModel';

const KOKORO_MODEL_SPEC = {
    modelId: 'kokoro-82m-q8',
    family: 'kokoro',
    url: KOKORO_MODEL_URL,
    sizeBytes: KOKORO_MODEL_SIZE_BYTES,
};

const VOCODER_MODEL_SPEC = {
    modelId: 'nsf-hifigan-44k',
    family: 'diffsinger/vocoder',
    url: NSF_HIFIGAN_URL,
    sizeBytes: NSF_HIFIGAN_SIZE_BYTES,
};

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function languageLabel(lang: 'en' | 'zh' | 'ja'): string {
    if (lang === 'en') {
        return 'English';
    }
    if (lang === 'zh') {
        return 'Chinese';
    }
    return 'Japanese';
}

type ModelActionProps = {
    id: string;
    name: string;
    family: string;
    url: string;
    sizeBytes: number;
    status: string;
    downloadProgress: number;
};

function ModelAction({ id, name, family, url, sizeBytes, status, downloadProgress }: ModelActionProps): ReactElement {
    const handleDownload = (): void => {
        void downloadModel({ modelId: id, family, url, sizeBytes });
    };
    const handleRemove = (): void => {
        void removeModel({ modelId: id, family });
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

type VoicebankActionProps = {
    voicebank: DiffSingerVoicebank;
};

function VoicebankAction({ voicebank }: VoicebankActionProps): ReactElement {
    const handleRemove = (): void => {
        // OPFS paths use slash-separated family: `diffsinger/${voicebankId}/${modelKey}`
        // This matches how renderDiffSingerPhrase reads sub-models via readModel().
        // model.family is the hyphen-typed ModelFamily enum value — do not use it here.
        const opfsFamily = `diffsinger/${voicebank.id}`;
        for (const key of ['linguistic', 'dur', 'pitch', 'variance', 'acoustic'] as const) {
            void removeModel({ modelId: key, family: opfsFamily });
        }
    };

    if (voicebank.status === 'downloading') {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="w-12 h-1 bg-border/40 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(voicebank.downloadProgress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Downloading ${voicebank.name}: ${Math.round(voicebank.downloadProgress * 100)}%`}
                >
                    <div
                        className="h-full bg-[var(--color-accent-lavender)] transition-all"
                        style={{ width: `${Math.round(voicebank.downloadProgress * 100)}%` }}
                    />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums">
                    {Math.round(voicebank.downloadProgress * 100)}%
                </span>
            </div>
        );
    }

    if (voicebank.status === 'ready') {
        return (
            <div className="flex items-center gap-2">
                <DawMicroBadge tone="success" aria-label={`${voicebank.name} ready`}>
                    ✓ Ready
                </DawMicroBadge>
                <button
                    type="button"
                    onClick={handleRemove}
                    className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label={`Remove ${voicebank.name} voicebank`}
                >
                    Remove
                </button>
            </div>
        );
    }

    return (
        <DawMicroBadge tone="muted" aria-label={`${voicebank.name} not ready`}>
            {voicebank.status === 'error' ? 'Error' : 'Not ready'}
        </DawMicroBadge>
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

    const kokoroStatus = registry?.kokoroModel?.status ?? 'not-downloaded';
    const kokoroProgress = registry?.kokoroModel?.downloadProgress ?? 0;
    const vocoderStatus = registry?.vocoder?.status ?? 'not-downloaded';
    const vocoderProgress = registry?.vocoder?.downloadProgress ?? 0;
    const diffSingerVoicebanks = registry?.diffSingerVoicebanks ?? [];

    // DDSP instruments: use registry status when available, fall back to static catalog
    const registryInstruments = registry?.ddspInstruments ?? [];
    const instruments = registryInstruments.length > 0 ? registryInstruments : DDSP_INSTRUMENT_CATALOG;

    const totalUsed = registry?.storageUsedBytes ?? 0;
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

            {/* DDSP Instruments */}
            <DawUtilitySection
                title="DDSP Instruments"
                detail="Monophonic synthesis · Apache 2.0 · Google Research · Loaded from CDN"
            >
                <div className="space-y-0.5">
                    {instruments.map((instrument) => {
                        const status = 'status' in instrument ? (instrument as { status: string }).status : undefined;
                        return (
                            <DawPickerRow
                                key={instrument.id}
                                heading={instrument.name}
                                description="CDN · ~15 MB · cached by browser"
                                endSlot={
                                    status === 'ready' ? (
                                        <DawMicroBadge
                                            tone="success"
                                            aria-label={`${instrument.name} cached and ready`}
                                        >
                                            ✓ Cached
                                        </DawMicroBadge>
                                    ) : (
                                        <DawMicroBadge tone="muted" aria-label={`${instrument.name} available via CDN`}>
                                            CDN
                                        </DawMicroBadge>
                                    )
                                }
                            />
                        );
                    })}
                </div>
            </DawUtilitySection>

            {/* Kokoro TTS */}
            <DawUtilitySection title="Kokoro TTS (82M)" detail="Vocal scratch tracks · Apache 2.0 · hexgrad">
                <DawPickerRow
                    heading="Kokoro-82M (q8)"
                    description={`21 voices · ${formatBytes(KOKORO_MODEL_SPEC.sizeBytes)}`}
                    endSlot={
                        <ModelAction
                            id={KOKORO_MODEL_SPEC.modelId}
                            name="Kokoro-82M (q8)"
                            family={KOKORO_MODEL_SPEC.family}
                            url={KOKORO_MODEL_SPEC.url}
                            sizeBytes={KOKORO_MODEL_SPEC.sizeBytes}
                            status={kokoroStatus}
                            downloadProgress={kokoroProgress}
                        />
                    }
                />
            </DawUtilitySection>

            {/* Vocoder */}
            <DawUtilitySection title="NSF-HiFiGAN Vocoder" detail="Shared mel→audio · CC-BY-NC-SA 4.0 · openvpi">
                <DawPickerRow
                    heading="NSF-HiFiGAN 44.1k"
                    description={`Shared across all voices · ${formatBytes(VOCODER_MODEL_SPEC.sizeBytes)}`}
                    endSlot={
                        <ModelAction
                            id={VOCODER_MODEL_SPEC.modelId}
                            name="NSF-HiFiGAN 44.1k"
                            family={VOCODER_MODEL_SPEC.family}
                            url={VOCODER_MODEL_SPEC.url}
                            sizeBytes={VOCODER_MODEL_SPEC.sizeBytes}
                            status={vocoderStatus}
                            downloadProgress={vocoderProgress}
                        />
                    }
                />
            </DawUtilitySection>

            {/* DiffSinger Voice Packs */}
            <DawUtilitySection
                title="DiffSinger Voice Packs"
                detail="Browser singing synthesis · Various licenses · ~115–160 MB per voice"
            >
                {diffSingerVoicebanks.length === 0 ? (
                    <div className="py-1.5 space-y-1">
                        <p className="text-[9px] text-muted-foreground/70">No voice packs installed.</p>
                        <p className="text-[9px] text-muted-foreground/50 leading-relaxed">
                            Voice packs are added automatically when a DiffSinger voicebank is imported. Each voicebank
                            requires ~115–160 MB of browser storage.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {diffSingerVoicebanks.map((vb) => (
                            <DawPickerRow
                                key={vb.id}
                                heading={vb.name}
                                description={`${languageLabel(vb.language)} · ${formatBytes(vb.totalSizeBytes)}`}
                                endSlot={<VoicebankAction voicebank={vb} />}
                            />
                        ))}
                    </div>
                )}
            </DawUtilitySection>

            {/* Attribution */}
            <section
                aria-labelledby="credits-heading"
                className="text-[9px] text-muted-foreground/55 border-t border-border/20 pt-2 space-y-0.5"
            >
                <p id="credits-heading" className="font-medium text-muted-foreground/70 mb-1">
                    AI Model Credits
                </p>
                <p>DDSP: Engel et al., ICLR 2020. Apache 2.0.</p>
                <p>Kokoro TTS: hexgrad. Apache 2.0.</p>
                <p>DiffSinger: Liu et al., AAAI 2022. Apache 2.0 (training code).</p>
                <p>NSF-HiFiGAN: openvpi/vocoders. CC-BY-NC-SA 4.0 (non-commercial).</p>
            </section>
        </div>
    );
}
