/**
 * Mounts the popup React application over the extension runtime.
 *
 * @file Popup-page entry point that mounts the React popup application.
 */

import "@mantine/core/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { createSettingsChangedSubscriber } from "../shared/messaging/settings-notifications";
import { createBrowserDownloadRuntime } from "../shared/ui/download-runtime";
import { PopupApp } from "./app";

const root = document.getElementById("root");
if (!root) {
    throw new Error("Popup root is missing");
}
const archiveRuntime = createBrowserDownloadRuntime();
createRoot(root).render(
    <PopupApp
        subscribe={createSettingsChangedSubscriber(chrome.runtime)}
        {...(archiveRuntime ? { archiveRuntime } : {})}
    />,
);
