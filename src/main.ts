import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./theme/tokens.css";
import "./styles.css";
import { App } from "./app";

// Phase 2: a tabbed terminal. Each tab hosts one pane for now; pane splitting
// arrives in Phase 3.
const root = document.querySelector<HTMLDivElement>("#root");

if (root) {
  void new App(root).start();
}
