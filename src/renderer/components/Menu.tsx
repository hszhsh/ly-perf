import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Menu.module.css";

export interface MenuItem {
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
    tone?: "default" | "danger";
    onSelect: () => void;
}

interface MenuProps {
    items: MenuItem[];
    ariaLabel: string;
    className?: string;
    onRequestClose?: () => void;
}

function findNextEnabledIndex(
    items: MenuItem[],
    currentIndex: number,
    direction: 1 | -1
): number {
    if (items.length === 0) {
        return -1;
    }

    let nextIndex = currentIndex;

    for (let attempts = 0; attempts < items.length; attempts += 1) {
        nextIndex = (nextIndex + direction + items.length) % items.length;

        if (!items[nextIndex]?.disabled) {
            return nextIndex;
        }
    }

    return -1;
}

export function Menu({
    items,
    ariaLabel,
    className,
    onRequestClose
}: MenuProps) {
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const firstEnabledIndex = useMemo(
        () => items.findIndex((item) => !item.disabled),
        [items]
    );
    const lastEnabledIndex = useMemo(() => {
        for (let index = items.length - 1; index >= 0; index -= 1) {
            if (!items[index]?.disabled) {
                return index;
            }
        }

        return -1;
    }, [items]);
    const [activeIndex, setActiveIndex] = useState(firstEnabledIndex);

    useEffect(() => {
        setActiveIndex(firstEnabledIndex);
    }, [firstEnabledIndex]);

    useEffect(() => {
        if (activeIndex < 0) {
            return;
        }

        itemRefs.current[activeIndex]?.focus();
    }, [activeIndex]);

    const rootClassName = className ? `${styles.menu} ${className}` : styles.menu;

    return (
        <div
            className={rootClassName}
            role="menu"
            aria-label={ariaLabel}
            onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((currentIndex) => {
                        const startIndex =
                            currentIndex >= 0 ? currentIndex : firstEnabledIndex - 1;
                        return findNextEnabledIndex(items, startIndex, 1);
                    });
                    return;
                }

                if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((currentIndex) => {
                        const startIndex =
                            currentIndex >= 0 ? currentIndex : lastEnabledIndex + 1;
                        return findNextEnabledIndex(items, startIndex, -1);
                    });
                    return;
                }

                if (event.key === "Home") {
                    event.preventDefault();
                    setActiveIndex(firstEnabledIndex);
                    return;
                }

                if (event.key === "End") {
                    event.preventDefault();
                    setActiveIndex(lastEnabledIndex);
                    return;
                }

                if (event.key === "Escape") {
                    event.preventDefault();
                    onRequestClose?.();
                }
            }}
        >
            {items.map((item, index) => {
                const tone = item.tone ?? "default";
                const itemClassName = [
                    styles.item,
                    index === activeIndex ? styles.itemActive : "",
                    tone === "danger" ? styles.itemDanger : ""
                ]
                    .filter(Boolean)
                    .join(" ");

                return (
                    <button
                        key={item.id}
                        ref={(element) => {
                            itemRefs.current[index] = element;
                        }}
                        type="button"
                        role="menuitem"
                        className={itemClassName}
                        disabled={item.disabled}
                        tabIndex={index === activeIndex ? 0 : -1}
                        onFocus={() => setActiveIndex(index)}
                        onMouseMove={() => {
                            if (item.disabled || index === activeIndex) {
                                return;
                            }

                            setActiveIndex(index);
                        }}
                        onClick={() => {
                            if (item.disabled) {
                                return;
                            }

                            item.onSelect();
                            onRequestClose?.();
                        }}
                    >
                        <span className={styles.label}>{item.label}</span>
                        {item.description ? (
                            <span className={styles.description}>
                                {item.description}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}