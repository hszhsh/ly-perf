import {
    type ReactNode,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState
} from "react";
import { LayerPortal } from "@renderer/components/LayerPortal";
import styles from "./Tooltip.module.css";

type TooltipPlacement = "top" | "bottom";

interface TooltipPosition {
    top: number;
    left: number;
}

interface TooltipProps {
    content: ReactNode;
    children: ReactNode;
    placement?: TooltipPlacement;
    offset?: number;
    disabled?: boolean;
}

function calculateTooltipPosition(params: {
    triggerRect: DOMRect;
    tooltipRect: DOMRect;
    placement: TooltipPlacement;
    offset: number;
}): { position: TooltipPosition; placement: TooltipPlacement } {
    const { triggerRect, tooltipRect, placement, offset } = params;
    const viewportPadding = 12;
    const centeredLeft =
        triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
    const left = Math.max(
        viewportPadding,
        Math.min(
            centeredLeft,
            window.innerWidth - tooltipRect.width - viewportPadding
        )
    );

    const topPlacement = Math.max(
        viewportPadding,
        triggerRect.top - tooltipRect.height - offset
    );
    const bottomPlacement = Math.min(
        triggerRect.bottom + offset,
        window.innerHeight - tooltipRect.height - viewportPadding
    );
    const fitsTop = triggerRect.top >= tooltipRect.height + offset + viewportPadding;
    const fitsBottom =
        triggerRect.bottom + tooltipRect.height + offset + viewportPadding <=
        window.innerHeight;

    let resolvedPlacement = placement;
    let top = placement === "top" ? topPlacement : bottomPlacement;

    if (placement === "top" && !fitsTop && fitsBottom) {
        resolvedPlacement = "bottom";
        top = bottomPlacement;
    }

    if (placement === "bottom" && !fitsBottom && fitsTop) {
        resolvedPlacement = "top";
        top = topPlacement;
    }

    return {
        placement: resolvedPlacement,
        position: {
            top,
            left
        }
    };
}

export function Tooltip({
    content,
    children,
    placement = "top",
    offset = 10,
    disabled = false
}: TooltipProps) {
    const tooltipId = useId();
    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<TooltipPosition | null>(null);
    const [resolvedPlacement, setResolvedPlacement] =
        useState<TooltipPlacement>(placement);
    const visible = open && !disabled;

    useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    useLayoutEffect(() => {
        if (!visible || !triggerRef.current || !tooltipRef.current) {
            return;
        }

        const updatePosition = () => {
            if (!triggerRef.current || !tooltipRef.current) {
                return;
            }

            const next = calculateTooltipPosition({
                triggerRect: triggerRef.current.getBoundingClientRect(),
                tooltipRect: tooltipRef.current.getBoundingClientRect(),
                placement,
                offset
            });

            setPosition(next.position);
            setResolvedPlacement(next.placement);
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [offset, placement, visible]);

    return (
        <>
            <span
                ref={triggerRef}
                className={styles.trigger}
                aria-describedby={visible ? tooltipId : undefined}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
            >
                {children}
            </span>

            {visible ? (
                <LayerPortal layer="tooltip">
                    <div
                        id={tooltipId}
                        ref={tooltipRef}
                        role="tooltip"
                        className={styles.tooltip}
                        data-placement={resolvedPlacement}
                        style={
                            position
                                ? {
                                      top: `${position.top}px`,
                                      left: `${position.left}px`
                                  }
                                : {
                                      visibility: "hidden"
                                  }
                        }
                    >
                        {content}
                    </div>
                </LayerPortal>
            ) : null}
        </>
    );
}