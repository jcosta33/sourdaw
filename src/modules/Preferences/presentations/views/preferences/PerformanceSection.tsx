import { type ReactElement } from 'react';

import { Cpu } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';

import { type Preferences, AUDIO_LATENCY_PROFILE_OPTIONS } from '../../../models/Preferences';
import { SectionTitle, FieldGroup } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const PerformanceSection = ({ prefs, update }: SectionProps): ReactElement => {
    function handleLatencyProfileChange(value: string): void {
        const profile = AUDIO_LATENCY_PROFILE_OPTIONS.find((option) => option.value === value)?.value;
        if (!profile) {
            return;
        }
        update({ audioLatencyProfile: profile });
    }

    return (
        <>
            <SectionTitle icon={<Cpu className="size-4" />} title="Performance" />

            <FieldGroup label="Audio Latency Profile">
                <DawCompactSelect
                    value={prefs.audioLatencyProfile}
                    onChange={(event) => handleLatencyProfileChange(event.target.value)}
                    className="w-full"
                    aria-label="Audio latency profile"
                >
                    {AUDIO_LATENCY_PROFILE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </DawCompactSelect>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Chrome chooses the actual buffer size and sample rate. Low latency prioritizes responsiveness; high
                    capacity prioritizes uninterrupted playback. This setting takes effect after reload.
                </p>
            </FieldGroup>
        </>
    );
};
