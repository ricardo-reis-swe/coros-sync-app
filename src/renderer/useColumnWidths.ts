import { useCallback, useEffect, useRef, useState } from 'react';

const DIVIDER = 5;
const MIN_COLUMN = 240;

// Two pixel widths; the third takes what is left. Each divider moves only the column to its left.
export const useColumnWidths = () => {
    const grid = useRef<HTMLDivElement>(null);
    const [widths, setWidths] = useState<[number, number] | null>(null);

    // Read during a drag instead of the state, which is a frame behind the mouse.
    const live = useRef<[number, number] | null>(null);
    live.current = widths;

    // Equal thirds of whatever the window is, measured once; until then the `fr` track below shows.
    useEffect(() => {
        const box = grid.current;
        if (!box || widths) return;

        const third = Math.max(MIN_COLUMN, (box.clientWidth - DIVIDER * 2) / 3);
        setWidths([third, third]);
    }, [widths]);

    const startDrag = useCallback((which: 0 | 1, event: React.MouseEvent) => {
        event.preventDefault();

        const from = live.current;
        if (!from) return;

        const startX = event.clientX;

        const move = (moved: MouseEvent) => {
            const next = Math.max(MIN_COLUMN, from[which] + moved.clientX - startX);
            setWidths(which === 0 ? [next, from[1]] : [from[0], next]);
        };

        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', stop);
            document.body.classList.remove('resizing');
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        // Suppresses the text cursor and row hover for the length of the drag.
        document.body.classList.add('resizing');
    }, []);

    const track = widths ? `${widths[0]}px ${DIVIDER}px ${widths[1]}px` : `minmax(0, 1fr) ${DIVIDER}px minmax(0, 1fr)`;

    return { grid, template: `${track} ${DIVIDER}px minmax(${MIN_COLUMN}px, 1fr)`, startDrag };
};
