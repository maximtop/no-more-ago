import "@mantine/core/styles.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Popup root is missing");
createRoot(root).render(<PopupApp />);
