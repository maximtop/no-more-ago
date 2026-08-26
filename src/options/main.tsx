/**
 * Mounts the options React application.
 *
 * @file Options-page entry point that mounts the React settings application.
 */

import "@mantine/core/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Options root is missing");
createRoot(root).render(<OptionsApp />);
