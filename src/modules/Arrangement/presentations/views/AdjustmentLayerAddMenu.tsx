import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

import { Plus } from 'lucide-react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton, DawMenuMutedRow } from '#/components/daw/DawMenuParts';
import { Button } from '#/components/ui/button';

import { type AdjustmentEffectType } from '../../stores/adjustmentLayer';

type AdjustmentLayerAddMenuProps = {
    onCreate: (effectType: AdjustmentEffectType) => void;
};

const ADD_MENU_WIDTH = 200;
const ADD_MENU_HEIGHT = 300;

const ALL_EFFECT_TYPES: AdjustmentEffectType[] = [
    'eq',
    'compressor',
    'reverb',
    'delay',
    'saturation',
    'filter',
    'stereo-width',
    'volume',
    'pan',
];

export const AdjustmentLayerAddMenu = ({ onCreate }: AdjustmentLayerAddMenuProps): ReactElement => {
    const [addMenuAnchor, setAddMenuAnchor] = useState<{ x: number; y: number } | null>(null);
    const addMenuRef = useRef<HTMLDivElement>(null);
    const addMenuTriggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!addMenuAnchor) {
            return undefined;
        }
        const handleClick = (event: globalThis.MouseEvent) => {
            if (
                event.target instanceof Node &&
                !addMenuRef.current?.contains(event.target) &&
                !addMenuTriggerRef.current?.contains(event.target)
            ) {
                setAddMenuAnchor(null);
            }
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [addMenuAnchor]);

    const closeAddMenu = () => setAddMenuAnchor(null);

    const toggleAddMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (addMenuAnchor) {
            closeAddMenu();
            return;
        }
        const button = event.currentTarget;
        const { right, bottom } = button.getBoundingClientRect();
        button.focus({ preventScroll: true });
        setAddMenuAnchor({ x: Math.max(0, right - ADD_MENU_WIDTH), y: bottom });
    };

    const handleAddMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAddMenu();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const current = options.findIndex((option) => option === event.target);
        const next = event.key === 'ArrowDown' ? (current + 1) % options.length : current - 1;
        (options[next] ?? options.at(-1))?.focus();
    };

    return (
        <>
            <Button
                variant="bare"
                size="bare"
                type="button"
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-white/10"
                ref={addMenuTriggerRef}
                onMouseDown={(event) => {
                    if (addMenuAnchor) {
                        // Preserve menu focus until the trigger click dismisses it.
                        event.preventDefault();
                    }
                }}
                onClick={toggleAddMenu}
                aria-label="Add adjustment layer"
                aria-haspopup="menu"
                aria-expanded={addMenuAnchor !== null}
            >
                <Plus className="size-3" />
            </Button>
            {addMenuAnchor ? (
                <DawContextMenuSurface
                    ref={addMenuRef}
                    x={addMenuAnchor.x}
                    y={addMenuAnchor.y}
                    xClampOffset={Math.min(ADD_MENU_WIDTH, window.innerWidth)}
                    yClampOffset={ADD_MENU_HEIGHT}
                    onClose={closeAddMenu}
                    onKeyDown={handleAddMenuKeyDown}
                    className="w-[200px] max-w-[100vw] p-1"
                    role="menu"
                    aria-label="New Adjustment Layer"
                >
                    <DawMenuMutedRow className="px-2">New Adjustment Layer</DawMenuMutedRow>
                    {ALL_EFFECT_TYPES.map((effectType) => (
                        <DawMenuButton
                            key={effectType}
                            role="menuitem"
                            onClick={() => {
                                onCreate(effectType);
                                closeAddMenu();
                            }}
                        >
                            {effectType.charAt(0).toUpperCase() + effectType.slice(1)}
                        </DawMenuButton>
                    ))}
                </DawContextMenuSurface>
            ) : null}
        </>
    );
};
