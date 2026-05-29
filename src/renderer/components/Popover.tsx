import {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState
} from "react";
import { LayerPortal } from "@renderer/components/LayerPortal";
import styles from "./Popover.module.css";

type PopoverVerticalPlacement = "top" | "bottom";
type PopoverHorizontalAlignment = "start" | "end";

export type PopoverPlacement =
    | "top-start"
    | "top-end"
    | "bottom-start"
    | "bottom-end";

interface PopoverPosition {
    top: number;
    left: number;
    minWidth: number;
    transformOrigin: string;
}

interface PopoverRenderContext {
    close: () => void;
    open: boolean;
}

interface PopoverTriggerProps {
    "aria-controls": string | undefined;
    "aria-expanded": boolean;
    "aria-haspopup": "dialog" | "menu";
    onClick: () => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

interface PopoverChildRenderProps {
    triggerRef: React.RefObject<HTMLButtonElement | null>;
    triggerProps: PopoverTriggerProps;
    open: boolean;
    close: () => void;
    toggle: () => void;
}

interface PopoverProps {
    content: ReactNode | ((context: PopoverRenderContext) => ReactNode);
    children: (props: PopoverChildRenderProps) => ReactNode;
    placement?: PopoverPlacement;
    offset?: number;
    disabled?: boolean;
    hasPopup?: "dialog" | "menu";
    panelClassName?: string;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function parsePlacement(
    placement: PopoverPlacement
): {
    vertical: PopoverVerticalPlacement;
    horizontal: PopoverHorizontalAlignment;
} {
    const [vertical, horizontal] = placement.split("-") as [
        PopoverVerticalPlacement,
        PopoverHorizontalAlignment
    ];

    return {
        vertical,
        horizontal
    };
}

function calculatePopoverPosition(params: {
    triggerRect: DOMRect;
    panelRect: DOMRect;
    placement: PopoverPlacement;
    offset: number;
}): { placement: PopoverPlacement; position: PopoverPosition } {
    const { triggerRect, panelRect, placement, offset } = params;
    const viewportPadding = 12;
    const requested = parsePlacement(placement);
    const panelWidth = Math.max(panelRect.width, triggerRect.width);
    const fitsBelow =
        triggerRect.bottom + panelRect.height + offset + viewportPadding <=
        window.innerHeight;
    const fitsAbove =
        triggerRect.top - panelRect.height - offset >= viewportPadding;

    let vertical = requested.vertical;

    if (requested.vertical === "bottom" && !fitsBelow && fitsAbove) {
        vertical = "top";
    }

    if (requested.vertical === "top" && !fitsAbove && fitsBelow) {
        vertical = "bottom";
    }

    const unclampedLeft =
        requested.horizontal === "start"
            ? triggerRect.left
            : triggerRect.right - panelWidth;
    const left = clamp(
        unclampedLeft,
        viewportPadding,
        window.innerWidth - panelWidth - viewportPadding
    );

    const preferredTop =
        vertical === "bottom"
            ? triggerRect.bottom + offset
            : triggerRect.top - panelRect.height - offset;
    const top = clamp(
        preferredTop,
        viewportPadding,
        window.innerHeight - panelRect.height - viewportPadding
    );

    return {
        placement: `${vertical}-${requested.horizontal}`,
        position: {
            top,
            left,
            minWidth: triggerRect.width,
            transformOrigin: `${requested.horizontal === "start" ? "left" : "right"} ${vertical === "bottom" ? "top" : "bottom"}`
        }
    };
}

export function Popover({
    content,
    children,
    placement = "bottom-start",
    offset = 8,
    disabled = false,
    hasPopup = "dialog",
    panelClassName
}: PopoverProps) {
    const popoverId = useId();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<PopoverPosition | null>(null);
    const [resolvedPlacement, setResolvedPlacement] =
        useState<PopoverPlacement>(placement);

    const visible = open && !disabled;

    const close = () => {
        setOpen(false);
    };

    const toggle = () => {
        setOpen((current) => !current);
    };

    useEffect(() => {
        if (!disabled) {
            return;
        }

        setOpen(false);
    }, [disabled]);

    useEffect(() => {
        if (!visible) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            const targetNode = event.target as Node;

            if (triggerRef.current?.contains(targetNode)) {
                return;
            }

            if (panelRef.current?.contains(targetNode)) {
                return;
            }

            close();
        };

        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }

            close();
            triggerRef.current?.focus();
        };

        window.addEventListener("mousedown", handlePointerDown);
        window.addEventListener("keydown", handleWindowKeyDown);

        return () => {
            window.removeEventListener("mousedown", handlePointerDown);
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, [visible]);

    useLayoutEffect(() => {
        if (!visible || !triggerRef.current || !panelRef.current) {
            return;
        }

        const updatePosition = () => {
            if (!triggerRef.current || !panelRef.current) {
                return;
            }

            const next = calculatePopoverPosition({
                triggerRect: triggerRef.current.getBoundingClientRect(),
                panelRect: panelRef.current.getBoundingClientRect(),
                placement,
                offset
            });

            setResolvedPlacement(next.placement);
            setPosition(next.position);
        };

        setPosition(null);
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [offset, placement, visible]);

    const renderedContent =
        typeof content === "function" ? content({ close, open: visible }) : content;

    return (
        <>
            {children({
                triggerRef,
                triggerProps: {
                    "aria-controls": visible ? popoverId : undefined,
                    "aria-expanded": visible,
                    "aria-haspopup": hasPopup,
                    onClick: toggle,
                    onKeyDown: (
                        event: ReactKeyboardEvent<HTMLButtonElement>
                    ) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            setOpen(true);
                            return;
                        }

                        if (event.key === "Escape") {
                            event.preventDefault();
                            close();
                        }
                    }
                },
                open: visible,
                close,
                toggle
            })}

            {visible ? (
                <LayerPortal layer="popover">
                    <div
                        id={popoverId}
                        ref={panelRef}
                        className={
                            panelClassName
                                ? `${styles.panel} ${panelClassName}`
                                : styles.panel
                        }
                        data-placement={resolvedPlacement}
                        style={
                            position
                                                                ? ({
                                      top: `${position.top}px`,
                                      left: `${position.left}px`,
                                      minWidth: `${position.minWidth}px`,
                                      "--popover-transform-origin":
                                          position.transformOrigin
                                                                    } as CSSProperties)
                                : {
                                      visibility: "hidden"
                                  }
                        }
                    >
                        {renderedContent}
                    </div>
                </LayerPortal>
            ) : null}
        </>
    );
}