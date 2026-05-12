import { useEffect, useState } from "react";
import { MonitorPage } from "@renderer/pages/MonitorPage";
import { ReportsPage } from "@renderer/pages/ReportsPage";
import styles from "./styles/App.module.css";

type TabKey = "monitor" | "reports";

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
                    <button
                        className={
                            activeTab === "reports"
                                ? styles.tabActive
                                : styles.tab
                        }
                        disabled={reportsDisabled}
                        onClick={() => setActiveTab("reports")}
                        title={
                            reportsDisabled
                                ? "实时监控启动中或进行中时，不能切换到历史报告。"
                                : undefined
                        }
                        type="button"
                    >
                        历史报告
                    </button>
                </nav>
            </header>

            <main className={styles.main}>
                {activeTab === "monitor" ? (
                    <MonitorPage onMonitorBusyChange={setIsMonitorBusy} />
                ) : (
                    <ReportsPage />
                )}
            </main>
        </div>
    );
}
