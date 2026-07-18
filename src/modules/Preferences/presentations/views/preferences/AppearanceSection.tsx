import { type ReactElement } from 'react';

import { Sun, Moon, Palette } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';

import { SectionTitle, FieldGroup, ToggleRow } from '../preferencesShared';

import type { Preferences } from '../../../models/Preferences';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const AppearanceSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<Palette className="size-4" />} title="Appearance" />

        <FieldGroup label="Theme">
            <div className="flex gap-2">
                {(['dark', 'light'] as const).map((time) => (
                    <Button
                        key={time}
                        variant={prefs.theme === time ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => {
                            update({ theme: time });
                            document.documentElement.classList.toggle('dark', time === 'dark');
                            document.documentElement.classList.toggle('light', time === 'light');
                        }}
                        className="capitalize gap-1"
                    >
                        {time === 'dark' ? <Moon className="size-3" /> : <Sun className="size-3" />}
                        {time}
                    </Button>
                ))}
            </div>
        </FieldGroup>

        <Separator />

        <ToggleRow
            label="Colorblind Mode"
            value={prefs.colorblindMode}
            onChange={(value) => update({ colorblindMode: value })}
        />

        <Separator />

        <FieldGroup label="UI Scale">
            <div className="flex items-center gap-2">
                <Slider
                    value={[prefs.uiScale * 100]}
                    onValueChange={([value]) => {
                        if (value !== undefined) {
                            update({ uiScale: value / 100 });
                        }
                    }}
                    min={50}
                    max={200}
                    step={5}
                    className="flex-1"
                    aria-label="UI Scale"
                />
                <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                    {Math.round(prefs.uiScale * 100)}%
                </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                Adjust the global interface size. Useful for high-DPI displays or custom window scaling.
            </p>
        </FieldGroup>
    </>
);
