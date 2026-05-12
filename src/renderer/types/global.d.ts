declare module "*.module.css" {
    const classes: Record<string, string>;
    export default classes;
}

declare module "*.css";

interface Window {
    lyPerf: import("@shared/types").LyPerfApi;
}
