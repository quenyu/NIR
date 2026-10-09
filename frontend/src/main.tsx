import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/geist-mono/300.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "reactflow/dist/style.css";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
