import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./router/AppRouter";
import "./index.css";
import { initAppearance } from "./theme/engine";

// Применяем сохранённое оформление до рендера (движок тем).
initAppearance();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);