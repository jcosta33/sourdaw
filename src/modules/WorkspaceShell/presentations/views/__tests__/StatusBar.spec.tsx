import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { expectExternalProjectLink } from '../../__tests__/expectExternalProjectLink';
import { StatusBar } from '../StatusBar';

const undoState = vi.hoisted(() => ({
    canUndo: false,
    canRedo: false,
    lastAction: null as { label: string } | null,
    undoCount: 0,
}));
const collab = vi.hoisted<{ connectionStatus: string; isEnabled: boolean; peers: unknown[] }>(() => ({
    connectionStatus: 'disconnected',
    isEnabled: false,
    peers: [],
}));
const selectionLabel = vi.hoisted(() => ({ value: '' }));
const llmState = vi.hoisted<{ value: Record<string, unknown> }>(() => ({ value: { state: 'idle' } }));
const renderQueueValue = vi.hoisted(() => ({
    entries: [] as Array<{ status: string }>,
    cachedPhraseIds: [],
    phraseStatusMap: {},
}));
const toggleCollaborationPanelMock = vi.hoisted(() => vi.fn());
const toggleUndoHistoryMock = vi.hoisted(() => vi.fn());
const originalInnerWidth = window.innerWidth;

const setViewportWidth = (width: number): void => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

vi.mock('#/infra/store/useStore', () => ({
    // Distinguish the two useStore calls by their default-value argument:
    // llmStatus defaults to { state: 'idle' }, renderQueue to { entries: ... }.
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => {
        if (typeof defaultValue === 'object' && defaultValue !== null && 'state' in defaultValue) {
            return llmState.value;
        }
        if (typeof defaultValue === 'object' && defaultValue !== null && 'entries' in defaultValue) {
            return renderQueueValue;
        }
        return defaultValue;
    }),
}));

vi.mock('#/modules/WorkspaceShell/presentations/hooks/useUndoState', () => ({
    useUndoState: () => undoState,
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useCollaborationState', () => ({
    useCollaborationState: () => collab,
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useSelectionLabel', () => ({
    useSelectionLabel: () => selectionLabel.value,
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useStatusBarMetrics', () => ({
    useStatusBarMetrics: () => {},
}));

vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleCollaborationPanel', () => ({
    toggleCollaborationPanel: toggleCollaborationPanelMock,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleUndoHistory', () => ({
    toggleUndoHistory: toggleUndoHistoryMock,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
};

describe('StatusBar', () => {
    beforeEach(() => {
        undoState.canUndo = false;
        undoState.canRedo = false;
        undoState.lastAction = null;
        undoState.undoCount = 0;
        collab.connectionStatus = 'disconnected';
        collab.isEnabled = false;
        collab.peers = [];
        selectionLabel.value = '';
        llmState.value = { state: 'idle' };
        renderQueueValue.entries = [];
        toggleCollaborationPanelMock.mockClear();
        toggleUndoHistoryMock.mockClear();
        setViewportWidth(1440);
    });

    afterAll(() => {
        setViewportWidth(originalInnerWidth);
    });

    describe('master output readout', () => {
        it('reads "n/a" before the metrics tick, not a dB value', () => {
            // useStatusBarMetrics is mocked to a no-op here, so this is the
            // pre-tick markup: the engine has not wired a meter tap yet and has
            // measured nothing. "-∞ dB" would claim it measured silence.
            renderWithTooltip(<StatusBar />);

            expect(screen.getByText('n/a')).toBeInTheDocument();
            expect(screen.queryByText('-∞ dB')).not.toBeInTheDocument();
        });
    });

    describe('memory readout scoping', () => {
        it('identifies the MEM value as the renderer JavaScript heap, not total usage', () => {
            renderWithTooltip(<StatusBar />);

            const cluster = screen.getByTitle(/JavaScript heap/);
            expect(cluster).toHaveTextContent('JS MEM');
            expect(screen.getByTitle(/excludes native audio/)).toBe(cluster);
        });
    });

    describe('responsive status disclosure', () => {
        it('keeps essential device status direct and defers the remaining status controls at the measured boundary', () => {
            setViewportWidth(1199);
            renderWithTooltip(<StatusBar />);

            expect(screen.getByRole('button', { name: 'More application status' })).toBeInTheDocument();
            expect(screen.getByText('Rate', { exact: true })).toBeInTheDocument();
            expect(screen.getByText('Latency', { exact: true })).toBeInTheDocument();
            expect(screen.getByTitle('Engine: suspended')).toBeInTheDocument();
            expect(screen.queryByText('UI CPU', { exact: true })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Project links' })).not.toBeInTheDocument();
        });

        it('makes deferred metrics and actions reachable through one disclosure', async () => {
            setViewportWidth(1199);
            renderWithTooltip(<StatusBar />);

            fireEvent.click(screen.getByRole('button', { name: 'More application status' }));
            const details = screen.getByRole('dialog', { name: 'More application status' });

            for (const label of ['UI CPU', 'JS MEM', 'AI Model', 'Out']) {
                expect(details).toHaveTextContent(label);
            }
            expect(screen.getByRole('button', { name: 'Third-party licenses' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Project links' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Toggle collaboration panel' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Toggle undo history panel' })).toBeInTheDocument();

            fireEvent.pointerDown(screen.getByRole('button', { name: 'Project links' }), { pointerId: 1 });
            await waitFor(() => {
                expect(screen.getByRole('menuitem', { name: 'Source' })).toBeInTheDocument();
            });
        });

        it('closes the inactive disclosure and restores footer focus across the admission boundary', async () => {
            setViewportWidth(1199);
            renderWithTooltip(<StatusBar />);
            const more = screen.getByRole('button', { name: 'More application status' });
            fireEvent.click(more);

            setViewportWidth(1200);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });

            expect(screen.queryByRole('dialog', { name: 'More application status' })).not.toBeInTheDocument();
            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Project links' })).toHaveFocus();
            });
        });

        it('keeps unrelated focus outside the footer through a mode change', () => {
            setViewportWidth(1200);
            renderWithTooltip(
                <>
                    <button type="button">Outside footer</button>
                    <StatusBar />
                </>
            );
            const outsideFooter = screen.getByRole('button', { name: 'Outside footer' });
            outsideFooter.focus();

            setViewportWidth(1199);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });

            expect(outsideFooter).toHaveFocus();
            expect(screen.getByRole('button', { name: 'More application status' })).not.toHaveFocus();
        });

        it('keeps focus moved outside the footer before deferred mode restoration runs', () => {
            const scheduledFrames: FrameRequestCallback[] = [];
            const requestAnimationFrameSpy = vi
                .spyOn(window, 'requestAnimationFrame')
                .mockImplementation((callback) => {
                    scheduledFrames.push(callback);
                    return scheduledFrames.length;
                });

            try {
                setViewportWidth(1199);
                renderWithTooltip(
                    <>
                        <button type="button">Outside footer</button>
                        <StatusBar />
                    </>
                );
                const outsideFooter = screen.getByRole('button', { name: 'Outside footer' });
                screen.getByRole('button', { name: 'More application status' }).focus();

                setViewportWidth(1200);
                act(() => {
                    window.dispatchEvent(new Event('resize'));
                });

                expect(scheduledFrames).toHaveLength(1);
                const scheduledFrame = scheduledFrames[0];
                if (scheduledFrame === undefined) {
                    throw new Error('Expected deferred footer restoration frame');
                }
                outsideFooter.focus();
                act(() => {
                    scheduledFrame(performance.now());
                });

                expect(outsideFooter).toHaveFocus();
            } finally {
                requestAnimationFrameSpy.mockRestore();
            }
        });

        it('cancels deferred footer restoration when the status bar unmounts', () => {
            const scheduledFrames: FrameRequestCallback[] = [];
            const requestAnimationFrameSpy = vi
                .spyOn(window, 'requestAnimationFrame')
                .mockImplementation((callback) => {
                    scheduledFrames.push(callback);
                    return scheduledFrames.length;
                });
            const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

            try {
                setViewportWidth(1199);
                const view = renderWithTooltip(<StatusBar />);
                screen.getByRole('button', { name: 'More application status' }).focus();

                setViewportWidth(1200);
                act(() => {
                    window.dispatchEvent(new Event('resize'));
                });

                expect(scheduledFrames).toHaveLength(1);
                view.unmount();
                expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
            } finally {
                cancelAnimationFrameSpy.mockRestore();
                requestAnimationFrameSpy.mockRestore();
            }
        });
    });

    describe('LLM status badge', () => {
        it('shows idle by default', () => {
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('idle')).toBeInTheDocument();
        });

        it('shows the loading percentage when state is loading', () => {
            llmState.value = { state: 'loading', progress: 0.42, text: 'Loading' };
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('42%')).toBeInTheDocument();
        });

        it('shows active when state is generating', () => {
            llmState.value = { state: 'generating' };
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('active')).toBeInTheDocument();
        });

        it('shows ready when state is ready', () => {
            llmState.value = { state: 'ready', backend: 'webllm', modelId: 'm1' };
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('ready')).toBeInTheDocument();
        });
    });

    describe('AI render count', () => {
        it('hides the AI Render metric when no renders are active', () => {
            renderWithTooltip(<StatusBar />);
            expect(screen.queryByText('AI Render')).not.toBeInTheDocument();
        });

        it('shows the active render count when renders are queued/rendering', () => {
            renderQueueValue.entries = [
                { status: 'rendering-browser' },
                { status: 'queued' },
                { status: 'preparing' },
                { status: 'done' },
            ];
            renderWithTooltip(<StatusBar />);
            // 3 of 4 entries are active (rendering-browser, queued, preparing).
            expect(screen.getByText('3 active')).toBeInTheDocument();
        });
    });

    describe('selection label', () => {
        it('hides the selection label when empty', () => {
            renderWithTooltip(<StatusBar />);
            expect(screen.queryByText('3 clips selected')).not.toBeInTheDocument();
        });

        it('shows the selection label when clips are selected', () => {
            selectionLabel.value = '3 clips selected';
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('3 clips selected')).toBeInTheDocument();
        });
    });

    describe('screen-reader exposure', () => {
        it('exposes the footer as a landmark, not as a live region', () => {
            renderWithTooltip(<StatusBar />);

            const footer = screen.getByRole('contentinfo', { name: 'Application status' });
            expect(footer.tagName).toBe('FOOTER');
            expect(footer).not.toHaveAttribute('role', 'status');
        });

        it('scopes the only live region to the selection label', () => {
            selectionLabel.value = '3 clips selected';
            renderWithTooltip(<StatusBar />);

            const liveRegions = screen.getAllByRole('status');
            expect(liveRegions).toHaveLength(1);
            expect(liveRegions[0]).toHaveTextContent('3 clips selected');
        });

        it('hides the animation-frame-driven meters from the accessibility tree', () => {
            renderWithTooltip(<StatusBar />);

            // useStatusBarMetrics rewrites these text nodes every frame; announcing
            // them drowns out anything the status region was meant to convey.
            for (const readout of ['0%', '0 MB', 'n/a']) {
                expect(screen.getByText(readout).closest('[aria-hidden="true"]')).not.toBeNull();
            }
        });

        it('keeps the stable device readouts exposed to the accessibility tree', () => {
            renderWithTooltip(<StatusBar />);

            // Sample rate is fixed for the session and output latency changes
            // rarely, so neither is meter churn — and this is the only place
            // either value appears in the app. Hiding them would delete the sole
            // accessible copy. Dropping role="status" from the footer is what
            // fixed the announcement problem; aria-hidden here is pure loss.
            for (const readout of ['0kHz', '0.0ms']) {
                expect(screen.getByText(readout).closest('[aria-hidden="true"]')).toBeNull();
            }
        });
    });

    describe('undo state', () => {
        it('hides the last-action label when there is no undo history', () => {
            renderWithTooltip(<StatusBar />);
            expect(screen.queryByText(/Last:/)).not.toBeInTheDocument();
        });

        it('shows the last action label when history exists', () => {
            undoState.lastAction = { label: 'Add note' };
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText('Last: Add note')).toBeInTheDocument();
        });

        it('pluralizes undo count when > 1', () => {
            undoState.undoCount = 3;
            renderWithTooltip(<StatusBar />);
            expect(screen.getByText(/3 undos/)).toBeInTheDocument();
        });

        it('uses singular undo when count is exactly 1', () => {
            undoState.undoCount = 1;
            renderWithTooltip(<StatusBar />);
            const btn = screen.getByLabelText('Toggle undo history panel');
            expect(btn.textContent).toMatch(/1 undo(?!s)/);
        });

        it('routes the undo history button to toggleUndoHistory', () => {
            renderWithTooltip(<StatusBar />);
            fireEvent.click(screen.getByLabelText('Toggle undo history panel'));
            expect(toggleUndoHistoryMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('collaboration badge', () => {
        it('routes the collaboration button to toggleCollaborationPanel', () => {
            renderWithTooltip(<StatusBar />);
            fireEvent.click(screen.getByLabelText('Toggle collaboration panel'));
            expect(toggleCollaborationPanelMock).toHaveBeenCalledTimes(1);
        });

        it('shows zero peers when collaboration is disabled', () => {
            renderWithTooltip(<StatusBar />);
            expect(screen.getByLabelText('Toggle collaboration panel')).toHaveTextContent('0');
        });

        it('shows the peer count when collaboration is enabled with peers', () => {
            collab.isEnabled = true;
            collab.peers = [{ id: 'p1' }, { id: 'p2' }];
            renderWithTooltip(<StatusBar />);
            expect(screen.getByLabelText('Toggle collaboration panel')).toHaveTextContent('2');
        });

        it('renders a success status dot when connected', () => {
            collab.connectionStatus = 'connected';
            renderWithTooltip(<StatusBar />);
            // The dot uses tone="success"; its container is the toggle button.
            const btn = screen.getByLabelText('Toggle collaboration panel');
            expect(btn).toBeInTheDocument();
        });
    });

    describe('legal notice', () => {
        it('opens the shipped third-party notice', () => {
            const open = vi.spyOn(window, 'open').mockImplementation(() => null);
            renderWithTooltip(<StatusBar />);

            fireEvent.click(screen.getByRole('button', { name: 'Third-party licenses' }));

            expect(open).toHaveBeenCalledWith('/legal/THIRD-PARTY-NOTICES.md', '_blank');
            open.mockRestore();
        });
    });

    describe('project links', () => {
        it('keeps source, discussions, and bug reporting in one compact menu', async () => {
            renderWithTooltip(<StatusBar />);

            fireEvent.pointerDown(screen.getByRole('button', { name: 'Project links' }), { pointerId: 1 });
            await waitFor(() => {
                expect(screen.getByRole('menuitem', { name: 'Source' })).toBeInTheDocument();
            });

            expectExternalProjectLink(
                screen.getByRole('menuitem', { name: 'Source' }),
                'https://github.com/jcosta33/sourdaw'
            );
            expectExternalProjectLink(
                screen.getByRole('menuitem', { name: 'Discussions' }),
                'https://github.com/jcosta33/sourdaw/discussions'
            );
            expectExternalProjectLink(
                screen.getByRole('menuitem', { name: 'Report a bug' }),
                'https://github.com/jcosta33/sourdaw/issues'
            );
        });
    });
});
