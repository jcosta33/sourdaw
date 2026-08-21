/**
 * Shared presentational primitives used across all preferences sections.
 */
import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { GRID_SNAP_OPTIONS, type GridSnapOption } from '../../models/Preferences';
import { CaptureKeyButton } from '../components/CaptureKeyButton';

// ── SectionTitle ──────────────────────────────────────────────────────

export const SectionTitle = ({ icon, title }: { icon: ReactElement; title: string }): ReactElement => (
    <Row gap={2} className="pb-2 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="daw-seam ml-2 h-px flex-1" />
    </Row>
);

// ── FieldGroup ────────────────────────────────────────────────────────

export const FieldGroup = ({ label, children }: { label: string; children: React.ReactNode }): ReactElement => (
    <Stack as="section" gap={1.5}>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">{label}</label>
        {children}
    </Stack>
);

// ── ToggleRow ─────────────────────────────────────────────────────────

export const ToggleRow = ({
    label,
    value,
    onChange,
    descriptionId,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
    descriptionId?: string;
}): ReactElement => (
    <Row justify="between">
        <span className="text-xs text-foreground">{label}</span>
        <Button
            variant="bare"
            size="bare"
            type="button"
            role="switch"
            aria-checked={value}
            aria-label={label}
            aria-describedby={descriptionId}
            className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted/50'}`}
            onClick={() => onChange(!value)}
        >
            <span
                className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`}
            />
        </Button>
    </Row>
);

// ── VoiceKeyEditor ────────────────────────────────────────────────────

export const VoiceKeyEditor = ({
    currentKey,
    onChange,
}: {
    currentKey: string;
    onChange: (key: string) => void;
}): ReactElement => {
    const [listening, setListening] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!listening) {
            return undefined;
        }
        const handler = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key.length === 1) {
                onChange(event.key.toLowerCase());
            }
            setListening(false);
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [listening, onChange]);

    return (
        <FieldGroup label="Voice Command Key">
            <Row gap={2}>
                <CaptureKeyButton
                    ref={ref}
                    listening={listening}
                    className="px-3 py-1.5 text-xs"
                    onClick={() => setListening(true)}
                >
                    {listening ? 'Press a key...' : currentKey.toUpperCase()}
                </CaptureKeyButton>
                <span className="text-[10px] text-muted-foreground">
                    {listening ? 'Listening for keypress' : 'Click to change — hold to activate voice input'}
                </span>
            </Row>
        </FieldGroup>
    );
};

// ── GridSubdivisionSection ────────────────────────────────────────────

const GRID_GROUPS: { label: string; options: GridSnapOption[] }[] = [
    { label: 'Standard', options: ['bar', 'beat', '1/2', '1/4', '1/8', '1/16', '1/32'] },
    { label: 'Triplet', options: ['1/4T', '1/8T', '1/16T'] },
    { label: 'Dotted', options: ['1/4D', '1/8D'] },
    { label: '', options: ['off'] },
];

export const GridSubdivisionSection = ({
    value,
    onChange,
}: {
    value: GridSnapOption;
    onChange: (v: GridSnapOption) => void;
}): ReactElement => (
    <FieldGroup label="Grid Snap">
        <Stack gap={1.5}>
            {GRID_GROUPS.map((group) => (
                <Row wrap gap={1} key={group.label || 'misc'}>
                    {group.label ? (
                        <span className="text-[9px] text-muted-foreground/60 w-12 shrink-0">{group.label}</span>
                    ) : null}
                    {group.options.map((opt) => {
                        const entry = GRID_SNAP_OPTIONS.find(
                            (output: { value: GridSnapOption; label: string }) => output.value === opt
                        );
                        return (
                            <Button
                                key={opt}
                                variant={value === opt ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={() => onChange(opt)}
                            >
                                {entry?.label ?? opt}
                            </Button>
                        );
                    })}
                </Row>
            ))}
        </Stack>
    </FieldGroup>
);
