import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "../App";
import ShopPage from "../pages/ShopPage";
import MenuPage from "../pages/MenuPage";
import EmployeesPage from "../pages/EmployeesPage";
import CardsPage from "../pages/CardsPage";
import GlobalExpensesPage from "../pages/GlobalExpensesPage";
import SuperAdminPage from "../pages/SuperAdminPage";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Super Admin панель — защищена токеном на самой странице */}
        <Route path="/super-admin" element={<SuperAdminPage />} />

        {/* Основное приложение */}
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<App />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/cards" element={<CardsPage />} />
        <Route path="/expenses" element={<GlobalExpensesPage />} />
      </Routes>
    </BrowserRouter>
  );
}
