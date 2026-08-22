import { ReactNode, useEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onSelect: () => void };

type MenuProps = {
    trigger: ReactNode;
    items: MenuItem[];
    align?: 'left' | 'right';
    className?: string;
    buttonClassName?: string;
    title?: string;
};

const Menu = ({ trigger, items, align = 'right', className, buttonClassName, title }: MenuProps) => {
    const [open, setOpen] = useState(false);
    const wrapper = useRef<HTMLSpanElement>(null);

    // A dropdown that only closes on its own items is a trap; outside and Escape both close it.
    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: PointerEvent) => {
            if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <span className={`menu${className ? ` ${className}` : ''}`} ref={wrapper}>
            <button
                className={buttonClassName}
                title={title}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                {trigger}
            </button>

            {open && (
                <div className={`menu-items menu-${align}`} role="menu">
                    {items.map((item) => (
                        <button
                            key={item.label}
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
};

export default Menu;
