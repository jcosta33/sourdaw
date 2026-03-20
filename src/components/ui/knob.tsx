import { type ReactElement, useState, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';

export type KnobProps = {
    value: number;
    onValueChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: number;
    size?: number;
    color?: string;
    className?: string;
    label?: string;
    formatValue?: (val: number) => string;
};

export const Knob = ({
    value,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    defaultValue,
    size = 30,
    color = 'hsl(var(--primary))',
    className,
    label,
    formatValue = (v) => v.toFixed(0),
}: KnobProps): ReactElement => {
    const [isDragging, setIsDragging] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const startY = useRef(0);
    const startValue = useRef(0);

    const range = max - min;
    const normalizedValue = range === 0 ? 0 : (value - min) / range;
    
    // Convert 0-1 to degrees (-135 to 135)
    const angle = normalizedValue * 270 - 135;

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            if (defaultValue !== undefined) {
                onValueChange(defaultValue);
            }
            return;
        }
        
        // Only trigger drag on main click
        if (e.button !== 0) return;
        
        setIsDragging(true);
        startY.current = e.clientY;
        startValue.current = value;
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        
        const deltaY = startY.current - e.clientY;
        const sensitivity = e.shiftKey ? 0.2 : 1.0; 
        
        // 100px drag = full range
        const deltaRaw = (deltaY / 100) * range * sensitivity;
        
        let newValue = startValue.current + deltaRaw;
        
        // Snap to step
        if (step > 0) {
            newValue = Math.round(newValue / step) * step;
        }
        
        newValue = Math.max(min, Math.min(max, newValue));
        if (newValue !== value) {
            onValueChange(newValue);
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleDoubleClick = () => {
        setEditValue(String(value));
        setIsEditing(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const num = parseFloat(editValue);
            if (!isNaN(num)) {
                let clamped = Math.max(min, Math.min(max, num));
                if (step > 0) {
                    clamped = Math.round(clamped / step) * step;
                }
                onValueChange(clamped);
            }
            setIsEditing(false);
        } else if (e.key === 'Escape') {
            setIsEditing(false);
        }
        e.stopPropagation();
    };

    const renderHalo = () => {
        const cx = size / 2;
        const cy = size / 2;
        const r = (size / 2) - 3;
        const startAngle = -135 * (Math.PI / 180);
        // Ensure angle limits
        const arcEndAngle = (angle === -135 ? -134.99 : angle) * (Math.PI / 180);
        
        const x1 = cx + r * Math.sin(startAngle);
        const y1 = cy - r * Math.cos(startAngle);
        const x2 = cx + r * Math.sin(arcEndAngle);
        const y2 = cy - r * Math.cos(arcEndAngle);
        
        // SVG path logic
        const largeArcFlag = arcEndAngle - startAngle > Math.PI ? 1 : 0;

        return (
            <path
                d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeLinecap="round"
            />
        );
    };

    return (
        <div className={cn("inline-flex flex-col items-center gap-1", className)}>
            <div 
                className="relative cursor-ns-resize rounded-full group outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ width: size, height: size }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onDoubleClick={handleDoubleClick}
                tabIndex={0}
                role="slider"
                aria-valuenow={value}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-label={label}
            >
                {/* Background Ring */}
                <svg width={size} height={size} className="absolute inset-0 pointer-events-none">
                    <circle 
                        cx={size/2} 
                        cy={size/2} 
                        r={(size/2)-3} 
                        fill="none" 
                        stroke="hsla(var(--border))" 
                        strokeWidth={3} 
                    />
                    {renderHalo()}
                </svg>

                {/* Knob Body */}
                <div 
                    className="absolute inset-[6px] rounded-full bg-surface-raised border border-border/50 shadow-inner flex items-center justify-center transition-colors group-hover:bg-surface-overlay"
                    style={{ transform: `rotate(${angle}deg)` }}
                >
                    {/* Indicator Line */}
                    <div className="w-[2px] h-[30%] bg-foreground/70 rounded-full absolute top-[2px]" />
                </div>

                {isEditing && (
                    <input
                        autoFocus
                        type="text"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 rounded bg-surface-overlay text-foreground text-[10px] text-center px-1 py-0.5 border border-primary outline-none ring-1 ring-primary z-50 shadow-lg"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => setIsEditing(false)}
                        onKeyDown={handleKeyDown}
                        // Prevent drag when editing
                        onPointerDown={e => e.stopPropagation()} 
                    />
                )}
            </div>
            {label && (
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <span className="text-[9px] font-mono text-foreground/80">{formatValue(value)}</span>
                </div>
            )}
        </div>
    );
};
