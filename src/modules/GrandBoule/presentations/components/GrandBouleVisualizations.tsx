import { type ReactElement, useId } from 'react';

import { ChevronDown } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { Row, Stack } from '#/components/layout';

import { PianoModel3D } from './PianoModel3D';
import { SpectralWaterfall } from './SpectralWaterfall';
import { StringVibrationView } from './StringVibrationView';

export type GrandBouleVisualization = 'piano' | 'strings' | 'spectrum';

type GrandBouleVisualizationsProps = {
    deviceId: string;
    activeNotes: ReadonlyMap<number, number>;
    sustainPedal: number;
    lidPosition: number;
    engineReady: boolean;
    analyser: AnalyserNode | null;
    sampleRate: number | undefined;
    openVisualizations: readonly GrandBouleVisualization[];
    pianoPreviewHeld: boolean;
    onToggleVisualization: (visualization: GrandBouleVisualization) => void;
    onPreviewHoldChange: (held: boolean) => void;
    onNoteOn: (midiNote: number, velocity: number) => void;
    onNoteOff: (midiNote: number) => void;
};

type Visualization = {
    id: GrandBouleVisualization;
    label: string;
    content: ReactElement;
};

function createVisualizations({
    deviceId,
    activeNotes,
    sustainPedal,
    lidPosition,
    engineReady,
    analyser,
    sampleRate,
    openVisualizations,
    onPreviewHoldChange,
    onNoteOn,
    onNoteOff,
}: GrandBouleVisualizationsProps): readonly Visualization[] {
    const pianoVisible = openVisualizations.includes('piano');
    return [
        {
            id: 'piano',
            label: 'Piano keyboard',
            content: (
                <>
                    {pianoVisible ? (
                        <p className="text-caption text-muted-foreground">
                            {engineReady ? 'Click the piano keys to audition notes.' : 'Piano audio is unavailable.'}
                        </p>
                    ) : null}
                    <PianoModel3D
                        key={deviceId}
                        activeNotes={activeNotes}
                        sustainPedal={sustainPedal}
                        lidPosition={lidPosition}
                        visible={pianoVisible}
                        onNoteOn={onNoteOn}
                        onNoteOff={onNoteOff}
                        onPreviewHoldChange={onPreviewHoldChange}
                        className="h-48 w-full"
                    />
                </>
            ),
        },
        {
            id: 'strings',
            label: 'String activity',
            content: (
                <>
                    <p className="text-caption text-muted-foreground">
                        Estimated string motion from note activity.
                        {activeNotes.size === 0 ? ' No notes are sounding.' : ''}
                    </p>
                    <StringVibrationView activeNotes={activeNotes} className="h-24 w-full" />
                </>
            ),
        },
        {
            id: 'spectrum',
            label: 'Spectrum history',
            content: (
                <>
                    <p className="text-caption text-muted-foreground">
                        {analyser
                            ? 'Recent frequency activity at the track output. The display stays dark during silence.'
                            : 'No track analyser is available.'}
                    </p>
                    {analyser ? (
                        <SpectralWaterfall analyser={analyser} sampleRate={sampleRate} className="h-36 w-full" />
                    ) : null}
                </>
            ),
        },
    ];
}

export const GrandBouleVisualizations = (props: GrandBouleVisualizationsProps): ReactElement => {
    const { engineReady, openVisualizations, pianoPreviewHeld, onToggleVisualization } = props;
    const visualizationId = useId();
    const visualizations = createVisualizations(props);

    return (
        <>
            <Row justify="between" wrap gap={2} shrink={false}>
                <Row wrap gap={1.5}>
                    {visualizations.map(({ id, label }) => {
                        const expanded = openVisualizations.includes(id);
                        const collapseDisabled = id === 'piano' && pianoPreviewHeld;
                        return (
                            <DawPluginChip
                                key={id}
                                caps={false}
                                className="gap-1"
                                aria-disabled={collapseDisabled || undefined}
                                aria-expanded={expanded}
                                aria-controls={`${visualizationId}-${id}`}
                                onClick={() => {
                                    if (collapseDisabled) {
                                        return;
                                    }
                                    onToggleVisualization(id);
                                }}
                            >
                                {label}
                                <ChevronDown aria-hidden="true" className={expanded ? 'size-3 rotate-180' : 'size-3'} />
                            </DawPluginChip>
                        );
                    })}
                </Row>
                <DawPluginMetricTile
                    className="grand-boule-window"
                    label="Engine"
                    value={engineReady ? 'ready' : 'idle'}
                    detail="WASM"
                />
            </Row>
            {visualizations.map(({ id, content }) => {
                const expanded = openVisualizations.includes(id);
                return (
                    <div id={`${visualizationId}-${id}`} key={id} hidden={!expanded} className="shrink-0">
                        {/* A late preview release can still arrive after the canvas is hidden. */}
                        {expanded || id === 'piano' ? (
                            <Stack gap={2} className="grand-boule-window p-2">
                                {content}
                            </Stack>
                        ) : null}
                    </div>
                );
            })}
        </>
    );
};
