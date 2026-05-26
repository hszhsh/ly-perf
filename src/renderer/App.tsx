import { lazy, Suspense, useEffect, useState } from "react";
import { Tooltip } from "@renderer/components/Tooltip";
import { MonitorPage } from "@renderer/pages/MonitorPage";
import styles from "./styles/App.module.css";

type TabKey = "monitor" | "reports";

const ReportsPage = lazy(async () => {
    const module = await import(
        /* webpackChunkName: "reports-page" */ "@renderer/pages/ReportsPage"
    );

    return {
        default: module.ReportsPage
    };
});

export function App() {
    const [activeTab, setActiveTab] = useState<TabKey>("monitor");
    const [isMonitorBusy, setIsMonitorBusy] = useState(false);
    const [isMonitorStateReady, setIsMonitorStateReady] = useState(false);

    useEffect(() => {
        let disposed = false;

        void (async () => {
            try {
                const state = await window.lyPerf.getMonitorState();
                if (!disposed) {
                    setIsMonitorBusy(state.running);
                }
            } finally {
                if (!disposed) {
                    setIsMonitorStateReady(true);
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, []);

    useEffect(() => {
        if (isMonitorBusy) {
            setActiveTab("monitor");
        }
    }, [isMonitorBusy]);

    const reportsDisabled = !isMonitorStateReady || isMonitorBusy;
    const reportsDisabledReason = reportsDisabled
        ? "实时监控启动中或进行中时，不能切换到历史报告。"
        : null;
    const reportsTabButton = (
        <button
            className={
                activeTab === "reports" ? styles.tabActive : styles.tab
            }
            disabled={reportsDisabled}
            onClick={() => setActiveTab("reports")}
            type="button"
        >
            历史报告
        </button>
    );

    return (
        <div className={styles.shell}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>LY Perf</h1>
                    <p className={styles.subtitle}>
                        Android App Performance Monitor
                    </p>
                </div>
                <nav className={styles.tabs}>
                    <button
                        className={
                            activeTab === "monitor"
                                ? styles.tabActive
                                : styles.tab
                        }
                        onClick={() => setActiveTab("monitor")}
                        type="button"
                    >
                        实时监控
                    </button>
                    {reportsDisabledReason ? (
                        <Tooltip content={reportsDisabledReason} placement="bottom">
                            <span className={styles.tabTooltipTrigger}>
                                {reportsTabButton}
                            </span>
                        </Tooltip>
                    ) : (
                        reportsTabButton
                    )}
                </nav>
            </header>

            <main className={styles.main}>
                {activeTab === "monitor" ? (
                    <MonitorPage onMonitorBusyChange={setIsMonitorBusy} />
                ) : (
                    <Suspense fallback={<p>历史报告加载中...</p>}>
                        <ReportsPage />
                    </Suspense>
                )}
            </main>
        </div>
    );
}
