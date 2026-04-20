import { type ReactElement } from 'react';

import { KeyboardMusic } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { MidiDevicePicker } from '#/modules/AudioEngine/presentations/views';

import { SectionTitle, FieldGroup } from '../preferencesShared';

import type { Preferences } from '../../../models/Preferences';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const MidiSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<KeyboardMusic className="size-4" />} title="MIDI" />

        <FieldGroup label="MIDI Input">
            <MidiDevicePicker />
        </FieldGroup>

        <Separator />

        <FieldGroup label="Default Velocity">
            <div className="flex items-center gap-2">
                <Slider
                    value={[prefs.defaultVelocity]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            update({ defaultVelocity: v });
                        }
                    }}
                    min={1}
                    max={127}
                    step={1}
                    className="flex-1"
                    aria-label="Default MIDI velocity"
                />
                <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">
                    {prefs.defaultVelocity}
                </span>
            </div>
        </FieldGroup>

        <FieldGroup label="Input Channel">
            <DawCompactSelect
                value={prefs.midiInputChannel === 'all' ? 'all' : String(prefs.midiInputChannel)}
                onChange={(e) =>
                    update({ midiInputChannel: e.target.value === 'all' ? 'all' : Number(e.target.value) })
                }
                className="w-full"
                aria-label="MIDI input channel"
            >
                <option value="all">All Channels</option>
                {Array.from({ length: 16 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                        Channel {i + 1}
                    </option>
                ))}
            </DawCompactSelect>
        </FieldGroup>
    </>
);
