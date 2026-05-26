import { type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getUiLayerCssValue, type UiLayerName } from "@renderer/utils/uiLayers";
import styles from "./LayerPortal.module.css";

interface LayerPortalProps {
    layer: UiLayerName;
    children: ReactNode;
}

export function LayerPortal({ layer, children }: LayerPortalProps) {
    if (typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div
            className={styles.root}
            style={
                {
                    "--layer-portal-z-index": getUiLayerCssValue(layer)
                } as CSSProperties
            }
        >
            {children}
        </div>,
        document.body
    );
}