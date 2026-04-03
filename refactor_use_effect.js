const fs = require('fs');

function replaceFile(file, edits) {
    let content = fs.readFileSync(file, 'utf8');
    for (const edit of edits) {
        if (content.includes(edit.old)) {
            content = content.replace(edit.old, edit.new);
            console.log(`Replaced in ${file}`);
        } else {
            console.error(`Could not find string in ${file}:\n${edit.old}`);
        }
    }
    fs.writeFileSync(file, content);
}

const files = {
  "src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx": [
     { old: "import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';", new: "import { type ReactElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';" },
     { old: "    useEffect(() => {\n        if (!scrollRef.current) {\n            return;\n        }\n        const firstWhite = octaveToFirstWhiteIdx(octave);", new: "    useLayoutEffect(() => {\n        if (!scrollRef.current) {\n            return;\n        }\n        const firstWhite = octaveToFirstWhiteIdx(octave);" }
  ],
  "src/modules/Arrangement/presentations/views/TrackListView.tsx": [
     { old: "    useState,\n    useEffect,\n    useSyncExternalStore,\n} from 'react';", new: "    useState,\n    useEffect,\n    useLayoutEffect,\n    useSyncExternalStore,\n} from 'react';" },
     { old: "    useEffect(() => {\n        const el = scrollRef.current;\n        if (!el) {", new: "    useLayoutEffect(() => {\n        const el = scrollRef.current;\n        if (!el) {" }
  ],
  "src/modules/Workspace/presentations/views/ArrangeView.tsx": [
     { old: "import { type ReactElement, type MouseEvent as ReactMouseEvent, type DragEvent, useSyncExternalStore, useState, useRef, useEffect } from 'react';", new: "import { type ReactElement, type MouseEvent as ReactMouseEvent, type DragEvent, useSyncExternalStore, useState, useRef, useEffect, useLayoutEffect } from 'react';" },
     { old: "    useEffect(() => {\n        const el = timelineContainerRef.current;", new: "    useLayoutEffect(() => {\n        const el = timelineContainerRef.current;" }
  ],
  "src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx": [
     { old: "import { type ReactElement, type RefObject, type WheelEvent, useRef, useState, useEffect, useSyncExternalStore } from 'react';", new: "import { type ReactElement, type RefObject, type WheelEvent, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';" },
     { old: "    const [width, setWidth] = useState(0);\n    useEffect(() => {\n        const el = ref.current;", new: "    const [width, setWidth] = useState(0);\n    useLayoutEffect(() => {\n        const el = ref.current;" }
  ],
  "src/modules/Arrangement/presentations/views/TimelineMinimap.tsx": [
     { old: "    useRef,\n    useEffect,\n    useState,\n    useSyncExternalStore,\n} from 'react';", new: "    useRef,\n    useEffect,\n    useLayoutEffect,\n    useState,\n    useSyncExternalStore,\n} from 'react';" },
     { old: "    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;\n    const scrollX = viewState?.scrollX ?? 0;\n\n    useEffect(() => {\n        const canvas = canvasRef.current;", new: "    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;\n    const scrollX = viewState?.scrollX ?? 0;\n\n    useLayoutEffect(() => {\n        const canvas = canvasRef.current;" },
     { old: "        ctx.lineTo(viewportStartPx + viewportWidthPx - 0.5, 0.5);\n        ctx.stroke();\n    }, [tracks, pixelsPerBeat, scrollX, containerWidth]);\n\n    useEffect(() => {\n        const container = containerRef.current;", new: "        ctx.lineTo(viewportStartPx + viewportWidthPx - 0.5, 0.5);\n        ctx.stroke();\n    }, [tracks, pixelsPerBeat, scrollX, containerWidth]);\n\n    useLayoutEffect(() => {\n        const container = containerRef.current;" }
  ],
  "src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx": [
     { old: "    useRef,\n    useEffect,\n    useState,\n    useSyncExternalStore,\n} from 'react';", new: "    useRef,\n    useEffect,\n    useLayoutEffect,\n    useState,\n    useSyncExternalStore,\n} from 'react';" },
     { old: "    // ── Report layout to parent ──────────────────────────────────────\n    useEffect(() => {\n        onBeatWidthChange?.(beatWidth);\n    }, [beatWidth, onBeatWidthChange]);\n\n    useEffect(() => {\n        const canvas = canvasRef.current;\n        const parent = canvas?.parentElement;\n        if (!parent) { return; }\n        const report = (): void => {\n            const parentWidth = parent.clientWidth;\n            const totalWidth = Math.max(parentWidth, GRID_BEATS * beatWidth);\n            onContentWidthChange?.(totalWidth);\n        };", new: "    // ── Report layout to parent ──────────────────────────────────────\n    useLayoutEffect(() => {\n        onBeatWidthChange?.(beatWidth);\n    }, [beatWidth, onBeatWidthChange]);\n\n    useLayoutEffect(() => {\n        const canvas = canvasRef.current;\n        const parent = canvas?.parentElement;\n        if (!parent) { return; }\n        const report = (): void => {\n            const parentWidth = parent.clientWidth;\n            const totalWidth = Math.max(parentWidth, GRID_BEATS * beatWidth);\n            onContentWidthChange?.(totalWidth);\n        };" }
  ],
  "src/modules/Workspace/presentations/views/AutomationLane/NotePropertyLane.tsx": [
     { old: "import { type ReactElement, type MouseEvent, useRef, useEffect, useSyncExternalStore } from 'react';", new: "import { type ReactElement, type MouseEvent, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';" },
     { old: "    const activeClip = activeTrack?.clips.find((c) => c.id === clipId);\n    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';\n    const selectedColor = brightenColor(clipColor, 0.22);\n\n    useEffect(() => {\n        const canvas = canvasRef.current;\n        const container = containerRef.current;", new: "    const activeClip = activeTrack?.clips.find((c) => c.id === clipId);\n    const clipColor = activeClip?.color || activeTrack?.color || 'oklch(0.45 0.06 250)';\n    const selectedColor = brightenColor(clipColor, 0.22);\n\n    useLayoutEffect(() => {\n        const canvas = canvasRef.current;\n        const container = containerRef.current;" }
  ],
  "src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx": [
     { old: "import { type ReactElement, useRef, useEffect, useSyncExternalStore } from 'react';", new: "import { type ReactElement, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';" },
     { old: "    useEffect(() => {\n        const resizeCanvas = () => {\n            if (canvasRef.current) {\n                const parent = canvasRef.current.parentElement;\n                if (parent) {\n                    canvasRef.current.width = parent.clientWidth;", new: "    useLayoutEffect(() => {\n        const resizeCanvas = () => {\n            if (canvasRef.current) {\n                const parent = canvasRef.current.parentElement;\n                if (parent) {\n                    canvasRef.current.width = parent.clientWidth;" }
  ],
  "src/modules/AiRuntime/presentations/views/PatternBrowser.tsx": [
     { old: "import { type ReactElement, useState, useRef, useEffect } from 'react';", new: "import { type ReactElement, useState, useRef, useEffect, useLayoutEffect } from 'react';" },
     { old: "const MiniPianoRoll = ({ notes, lengthBeats }: { notes: PatternNote[]; lengthBeats: number }): ReactElement => {\n    const canvasRef = useRef<HTMLCanvasElement>(null);\n\n    useEffect(() => {\n        const canvas = canvasRef.current;", new: "const MiniPianoRoll = ({ notes, lengthBeats }: { notes: PatternNote[]; lengthBeats: number }): ReactElement => {\n    const canvasRef = useRef<HTMLCanvasElement>(null);\n\n    useLayoutEffect(() => {\n        const canvas = canvasRef.current;" }
  ]
};

for (const [file, edits] of Object.entries(files)) {
  replaceFile(file, edits);
}
