import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { paintTheme } from "./theme.ts";
import { mountFooter } from "./footer.js";

paintTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Shared footer: version, last update, changes, home link and contact (footer.js).
mountFooter(__BUILD_INFO__);
