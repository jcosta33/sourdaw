import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';

import { KOKORO_VOICE_ARTIFACTS } from '../../models/KokoroArtifactManifest';

type KokoroVoiceSelectorProps = {
    value: string;
    onChange: (voiceId: string) => void;
    disabled?: boolean;
    className?: string;
};

const ACCENT_LABELS: Record<string, string> = {
    american: 'American English',
    british: 'British English',
};

const GENDER_LABELS: Record<string, string> = {
    female: 'Female',
    male: 'Male',
};

// Use '|' as separator — accent/gender values never contain '|'
type GroupKey = `${string}|${string}`;

/** Dropdown selector exposing all 21 Kokoro TTS voices, grouped by accent and gender. */
export function KokoroVoiceSelector({
    value,
    onChange,
    disabled = false,
    className,
}: KokoroVoiceSelectorProps): ReactElement {
    // Group voices by accent then gender for <optgroup> nesting
    const groups = new Map<GroupKey, Array<(typeof KOKORO_VOICE_ARTIFACTS)[number]>>();
    for (const voice of KOKORO_VOICE_ARTIFACTS) {
        const key: GroupKey = `${voice.accent}|${voice.gender}`;
        const existing = groups.get(key);
        if (existing) {
            existing.push(voice);
        } else {
            groups.set(key, [voice]);
        }
    }

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        onChange(event.target.value);
    };

    return (
        <DawCompactSelect
            value={value}
            onChange={handleChange}
            disabled={disabled}
            aria-label="Kokoro TTS voice"
            className={className}
        >
            {Array.from(groups.entries()).map(([key, voices]) => {
                const separatorIdx = key.indexOf('|');
                const accent = key.slice(0, separatorIdx);
                const gender = key.slice(separatorIdx + 1);
                const label = `${ACCENT_LABELS[accent] ?? accent} · ${GENDER_LABELS[gender] ?? gender}`;
                return (
                    <optgroup key={key} label={label}>
                        {voices.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                                {voice.name}
                            </option>
                        ))}
                    </optgroup>
                );
            })}
        </DawCompactSelect>
    );
}
