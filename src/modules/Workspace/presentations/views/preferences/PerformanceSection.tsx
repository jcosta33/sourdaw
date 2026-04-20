import { type ReactElement } from 'react';

import { Cpu } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';

import {
    type Preferences,
    BUFFER_SIZE_OPTIONS,
    SAMPLE_RATE_OPTIONS,
    type BufferSizeOption,
    type SampleRateOption,
} from '../../../models/Preferences';
import { SectionTitle, FieldGroup } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const PerformanceSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<Cpu className="size-4" />} title="Performance" />

        <FieldGroup label="Buffer Size">
            <div className="flex items-center gap-2">
                <DawCompactSelect
                    value={prefs.bufferSize}
                    onChange={(e) => update({ bufferSize: Number(e.target.value) as BufferSizeOption })}
                    className="flex-1"
                    aria-label="Buffer size"
                >
                    {BUFFER_SIZE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </DawCompactSelect>
                <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                    ~{((prefs.bufferSize / prefs.sampleRate) * 1000).toFixed(1)}ms latency
                </span>
            </div>
        </FieldGroup>

        <FieldGroup label="Sample Rate">
            <DawCompactSelect
                value={prefs.sampleRate}
                onChange={(e) => update({ sampleRate: Number(e.target.value) as SampleRateOption })}
                className="w-full"
                aria-label="Sample rate"
            >
                {SAMPLE_RATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </DawCompactSelect>
        </FieldGroup>
    </>
);
