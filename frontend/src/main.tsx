import "@fontsource-variable/hanken-grotesk";
import "./ui/styles.css";
import "./state/theme";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
