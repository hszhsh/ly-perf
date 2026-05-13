import type {
    SessionTimelineEventInput,
    SessionTimelineEventType
} from "@shared/types";

export interface TimelineEventTypePreset {
    type: SessionTimelineEventType;
    label: string;
    description: string;
    defaultColor: string;
}

export const TIMELINE_EVENT_TYPE_PRESETS: TimelineEventTypePreset[] = [
    {
        type: "note",
        label: "备注",
        description: "普通说明、阶段记录或观察结论。",
        defaultColor: "#7dd3fc"
    },
    {
        type: "action",
        label: "操作",
        description: "用户操作、场景切换、配置调整等动作。",
        defaultColor: "#86efac"
    },
    {
        type: "issue",
        label: "问题",
        description: "卡顿、异常、告警、崩溃等问题点。",
        defaultColor: "#fca5a5"
    }
];

const PRESET_MAP = Object.fromEntries(
    TIMELINE_EVENT_TYPE_PRESETS.map((preset) => [preset.type, preset])
) as Record<SessionTimelineEventType, TimelineEventTypePreset>;

export function getTimelineEventTypeLabel(
    type: SessionTimelineEventType
): string {
    return PRESET_MAP[type]?.label ?? type;
}

export function getTimelineEventDefaultColor(
    type: SessionTimelineEventType
): string {
    return PRESET_MAP[type]?.defaultColor ?? "#7dd3fc";
}

export function createDefaultTimelineEventInput(
    timestamp: number
): SessionTimelineEventInput {
    return {
        timestamp: Math.floor(timestamp),
        type: "note",
        color: getTimelineEventDefaultColor("note"),
        text: ""
    };
}