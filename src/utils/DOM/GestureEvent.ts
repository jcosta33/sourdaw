/**
 * Safari/WebKit gesture event extension.
 * Used for pinch-to-zoom on trackpads where `gesturestart`/`gesturechange`
 * events carry `scale` and `rotation` properties.
 */
export type GestureEvent = UIEvent & {
    readonly scale: number;
    readonly rotation: number;
};
