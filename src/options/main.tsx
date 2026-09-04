/**
 * Mounts the options React application over the extension runtime.
 *
 * @file Options-page entry point that mounts the React settings application.
 */

import "@mantine/core/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { applyDocumentLocale } from "../shared/i18n/translator";
import { createSettingsChangedSubscriber } from "../shared/messaging/settings-notifications";
import { createBrowserDownloadRuntime } from "../shared/ui/download-runtime";
import { OptionsApp } from "./app";

const root = document.getElementById("root");
if (!root) {
    throw new Error("Options root is missing");
}
applyDocumentLocale("options_document_title");
const archiveRuntime = createBrowserDownloadRuntime();
createRoot(root).render(
    <OptionsApp
        subscribe={createSettingsChangedSubscriber(chrome.runtime)}
        version={chrome.runtime.getManifest().version}
        {...(archiveRuntime ? { archiveRuntime } : {})}
    />,
);
