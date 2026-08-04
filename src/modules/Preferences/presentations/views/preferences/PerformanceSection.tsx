import { type ChangeEvent, type ReactElement } from 'react';

import { Cpu } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';

import {
    type Preferences,
    AUDIO_LATENCY_PROFILE_OPTIONS,
    DEFAULT_AUDIO_LATENCY_PROFILE,
    isAudioLatencyProfile,
} from '../../../models/Preferences';
import { SectionTitle, FieldGroup } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const PerformanceSection = ({ prefs, update }: SectionProps): ReactElement => {
    const selectedProfile = isAudioLatencyProfile(prefs.audioLatencyProfile)
        ? prefs.audioLatencyProfile
        : DEFAULT_AUDIO_LATENCY_PROFILE;
    const profileDescription =
        selectedProfile === 'lowLatency'
            ? 'Prioritizes response for live playing and recording.'
            : 'Gives dense sessions more output headroom.';
    const handleProfileChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const profile = event.target.value;
        if (!isAudioLatencyProfile(profile)) {
            return;
        }
        update({ audioLatencyProfile: profile });
    };

    return (
        <>
            <SectionTitle icon={<Cpu className="size-4" />} title="Performance" />

            <FieldGroup label="Audio Processing Profile">
                <DawCompactSelect
                    value={selectedProfile}
                    onChange={handleProfileChange}
                    className="w-full"
                    aria-label="Audio processing profile"
                >
                    {AUDIO_LATENCY_PROFILE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </DawCompactSelect>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {profileDescription} Chrome chooses the actual device latency. Takes effect after reloading Sourdaw.
                </p>
            </FieldGroup>
        </>
    );
};
