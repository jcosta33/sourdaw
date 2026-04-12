import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { Sun, Moon, Palette } from 'lucide-react';
import type { Preferences } from '../../../models/Preferences';
import { SectionTitle, FieldGroup, ToggleRow } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const AppearanceSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<Palette className="size-4" />} title="Appearance" />

        <FieldGroup label="Theme">
            <div className="flex gap-2">
                {(['dark', 'light'] as const).map((t) => (
                    <Button
                        key={t}
                        variant={prefs.theme === t ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => {
                            update({ theme: t });
                            document.documentElement.classList.toggle('dark', t === 'dark');
                            document.documentElement.classList.toggle('light', t === 'light');
                        }}
                        className="capitalize gap-1"
                    >
                        {t === 'dark' ? <Moon className="size-3" /> : <Sun className="size-3" />}
                        {t}
                    </Button>
                ))}
            </div>
        </FieldGroup>

        <Separator />

        <ToggleRow
            label="Colorblind Mode"
            value={prefs.colorblindMode}
            onChange={(v) => update({ colorblindMode: v })}
        />

        <Separator />

        <FieldGroup label="UI Scale">
            <div className="flex items-center gap-2">
                <Slider
                    value={[prefs.uiScale * 100]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            update({ uiScale: v / 100 });
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
