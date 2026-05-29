export const UI_LAYER_VARIABLES = {
    base: "--layer-base",
    raised: "--layer-raised",
    popover: "--layer-popover",
    dropdown: "--layer-dropdown",
    tooltip: "--layer-tooltip",
    toast: "--layer-toast",
    modal: "--layer-modal"
} as const;

export type UiLayerName = keyof typeof UI_LAYER_VARIABLES;

export function getUiLayerCssValue(layer: UiLayerName): string {
    return `var(${UI_LAYER_VARIABLES[layer]})`;
}