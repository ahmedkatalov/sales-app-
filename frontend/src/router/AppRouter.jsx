import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "../App";
import ShopPage from "../pages/ShopPage";
import MenuPage from "../pages/MenuPage";
import EmployeesPage from "../pages/EmployeesPage";
import CardsPage from "../pages/CardsPage";
import SuperAdminPage from "../pages/SuperAdminPage";

export default function AppRouter() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}
