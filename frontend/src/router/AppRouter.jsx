import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "../App";

// Standalone-страницы (киоск/админка) грузятся лениво — не тянутся в общий бандл.
const ShopPage = lazy(() => import("../pages/ShopPage"));
const MenuPage = lazy(() => import("../pages/MenuPage"));
const EmployeesPage = lazy(() => import("../pages/EmployeesPage"));
const CardsPage = lazy(() => import("../pages/CardsPage"));
const SuperAdminPage = lazy(() => import("../pages/SuperAdminPage"));

const Fallback = (
  <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#060c1c", color: "#94a3b8", fontFamily: "system-ui, sans-serif" }}>
    Загрузка…
  </div>
);

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={Fallback}>
        <Routes>
          {/* Super Admin панель — защищена токеном */}
          <Route path="/super-admin" element={<SuperAdminPage />} />

          {/* Публичные standalone страницы (TV/киоск) — без навигации App */}
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/cards" element={<CardsPage />} />

          {/* Основное приложение — все остальные роуты включая /expenses, /work, /pos и т.д. */}
          <Route path="/*" element={<App />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
