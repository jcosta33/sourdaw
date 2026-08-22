import { useEffect, useState, type ReactElement } from 'react';

import { Maximize2, Minimize2, Minus, X } from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

import { windowChromeControls } from '../../../useCases/windowChrome';

/**
 * The frameless Linux build's own minimize/maximize/close, drawn at the far
 * right of the header's title row. Renders nothing elsewhere: macOS chrome is
 * the window-controls overlay and Windows keeps the native frame.
 */
export const WindowControls = (): ReactElement | null => {
    const frameless = windowChromeControls().frameless;
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        if (!windowChromeControls().frameless) {
            return undefined;
        }
        const controls = windowChromeControls();
        let active = true;
        const unlisten = controls.listenMaximized(setMaximized);
        void controls.isMaximized().then((value) => {
            if (active) {
                setMaximized(value);
            }
        });
        return () => {
            active = false;
            unlisten();
        };
    }, []);

    if (!frameless) {
        return null;
    }

    const minimize = (): void => {
        void windowChromeControls().minimize();
    };

    const toggleMaximize = (): void => {
        void windowChromeControls()
            .toggleMaximize()
            .then((value) => {
                setMaximized(value);
            });
    };

    const close = (): void => {
        void windowChromeControls().close();
    };

    return (
        <DawTransportCluster role="group" aria-label="Window controls">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Minimize window"
                        onClick={minimize}
                        data-testid="window-minimize"
                    >
                        <Minus className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Minimize</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={maximized ? 'Restore window' : 'Maximize window'}
                        onClick={toggleMaximize}
                        data-testid="window-toggle-maximize"
                    >
                        {maximized ? (
                            <Minimize2 className="size-3.5" aria-hidden="true" />
                        ) : (
                            <Maximize2 className="size-3.5" aria-hidden="true" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{maximized ? 'Restore' : 'Maximize'}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close window"
                        onClick={close}
                        data-testid="window-close"
                    >
                        <X className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
            </Tooltip>
        </DawTransportCluster>
    );
};
