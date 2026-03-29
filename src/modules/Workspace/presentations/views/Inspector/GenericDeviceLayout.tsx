/**
 * Generic device layout with smart parameter grouping.
 *
 * Groups parameters into sections by name-based pattern matching:
 * - Primary: the most commonly adjusted parameters (gain, mix, cutoff, threshold)
 * - Grouped: parameters with common prefixes (filter*, osc*, env*)
 * - Advanced: remaining parameters collapsed by default
 *
 * This replaces the flat ParamGrid fallback for devices without
 * custom layouts, reducing scrolling for effects with many parameters.
 */
import { type ReactElement, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '#/components/ui/card';
import { type DeviceLayoutProps, SectionHeader } from './deviceLayoutRegistry';
import { DeviceParameterControl } from './DeviceParameterControl';

type DeviceParam = DeviceLayoutProps['parameters'][number];

/** Parameters that are almost always the "main" controls. */
const PRIMARY_NAMES = new Set([
    'gain', 'volume', 'level', 'mix', 'dryWet', 'dry/wet', 'drywet',
    'threshold', 'ratio', 'drive', 'amount', 'depth', 'rate', 'time',
    'cutoff', 'frequency', 'size', 'decay', 'feedback', 'width',
]);

/** Group name rules based on parameter ID prefixes/patterns. */
const GROUP_RULES: Array<{ test: (id: string) => boolean; group: string }> = [
    { test: (id) => /^(filter|cutoff|resonance|q\b)/i.test(id), group: 'Filter' },
    { test: (id) => /^(osc|waveform|detune)/i.test(id), group: 'Oscillator' },
    { test: (id) => /^(attack|decay|sustain|release|env)/i.test(id), group: 'Envelope' },
    { test: (id) => /^(lfo|vibrato|modulation|mod)/i.test(id), group: 'Modulation' },
    { test: (id) => /^(low|mid|high|band|freq)/i.test(id), group: 'EQ' },
    { test: (id) => /^(delay|time|feedback|sync)/i.test(id), group: 'Timing' },
    { test: (id) => /^(reverb|room|size|damp|predelay)/i.test(id), group: 'Space' },
    { test: (id) => /^(comp|threshold|ratio|knee|makeup)/i.test(id), group: 'Dynamics' },
];

function isPrimary(param: DeviceParam): boolean {
    const id = param.id.toLowerCase();
    const name = param.name.toLowerCase();
    return PRIMARY_NAMES.has(id) || PRIMARY_NAMES.has(name);
}

function getGroup(param: DeviceParam): string | null {
    for (const rule of GROUP_RULES) {
        if (rule.test(param.id)) {
            return rule.group;
        }
    }
    return null;
}

type ParamSection = {
    title: string;
    params: DeviceParam[];
    isAdvanced: boolean;
};

function groupParameters(params: DeviceParam[]): ParamSection[] {
    const primary: DeviceParam[] = [];
    const groups = new Map<string, DeviceParam[]>();
    const ungrouped: DeviceParam[] = [];

    for (const p of params) {
        if (isPrimary(p)) {
            primary.push(p);
            continue;
        }
        const group = getGroup(p);
        if (group) {
            const existing = groups.get(group) ?? [];
            existing.push(p);
            groups.set(group, existing);
        } else {
            ungrouped.push(p);
        }
    }

    const sections: ParamSection[] = [];

    if (primary.length > 0) {
        sections.push({ title: 'Main', params: primary, isAdvanced: false });
    }

    for (const [title, gParams] of groups) {
        sections.push({ title, params: gParams, isAdvanced: false });
    }

    if (ungrouped.length > 0) {
        // Only collapse for instruments with many params (15+), not for small effects
        const isAdvanced = params.length > 14;
        sections.push({
            title: isAdvanced ? 'Advanced' : 'Other',
            params: ungrouped,
            isAdvanced,
        });
    }

    return sections;
}

const ParamRow = ({ params, device, trackId }: {
    params: DeviceParam[];
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => {
    const cols = Math.min(2, params.length); // Max 2 per row in the narrow inspector
    return (
        <div className={`grid grid-cols-1 @md:grid-cols-${String(cols)} gap-2`}>
            {params.map((param) => (
                <Card key={param.id} className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full pb-4">
                    <DeviceParameterControl param={param} device={device} trackId={trackId} />
                </Card>
            ))}
        </div>
    );
};

const CollapsibleSection = ({
    title,
    children,
    defaultOpen = true,
}: {
    title: string;
    children: ReactElement;
    defaultOpen?: boolean;
}): ReactElement => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div>
            <button
                type="button"
                className="flex items-center gap-1 w-full px-1 mb-2 border-b border-border-hairline pb-1 cursor-pointer hover:bg-surface-raised/50 rounded-t-sm"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
            >
                <ChevronDown
                    className={`size-3 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {title}
                </span>
            </button>
            {open ? children : null}
        </div>
    );
};

export const GenericDeviceLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const sections = groupParameters(parameters);

    // Effects have ≤10 params — show flat grid with section headers, no collapsing.
    // Only instruments with 11+ params get collapsible sections.
    if (parameters.length <= 10) {
        return (
            <div>
                <SectionHeader title="Parameters" />
                <ParamRow params={parameters} device={device} trackId={trackId} />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {sections.map((section) => (
                <CollapsibleSection
                    key={section.title}
                    title={section.title}
                    defaultOpen={!section.isAdvanced}
                >
                    <ParamRow params={section.params} device={device} trackId={trackId} />
                </CollapsibleSection>
            ))}
        </div>
    );
};
