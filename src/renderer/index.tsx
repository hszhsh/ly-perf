import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { App } from "@renderer/App";
import "./styles/global.css";

const container = document.getElementById("root");

if (!container) {
    throw new Error("Renderer root container not found.");
}

const root = createRoot(container);

root.render(
    <StrictMode>
        <App />
    </StrictMode>
);
