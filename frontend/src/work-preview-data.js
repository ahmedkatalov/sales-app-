// Isolated data for the local design preview. Requests never reach the backend.
const types = [{ id: 1, name: "Бар" }, { id: 2, name: "Кухня" }];
const categories = [
  { id: 1, typeId: 1, name: "Кофе" },
  { id: 2, typeId: 1, name: "Авторские напитки" },
  { id: 3, typeId: 1, name: "Лимонады и фреши" },
  { id: 4, typeId: 2, name: "Выпечка" },
  { id: 5, typeId: 2, name: "Завтраки" },
];
const warehouse = [
  { id: 1, name: "Кофе в зёрнах", unit: "g", quantity: 12000, unitCost: 1.4, price: 16800 },
  { id: 2, name: "Молоко", unit: "ml", quantity: 30000, unitCost: .1, price: 3000 },
];
const recipe = [{ warehouseItemId: 1, ingredientName: "Кофе в зёрнах", quantity: 18, quantityUnit: "g" }];
const products = [
  { id: 1, name: "Капучино", typeId: 1, categoryId: 1, price: 250, cost: 62, recipe },
  { id: 2, name: "Латте с солёной карамелью", typeId: 1, categoryId: 2, price: 320, cost: 0, recipe: [{ ingredientName: "Карамель", quantity: 20, quantityUnit: "g", unlinked: true }] },
  { id: 3, name: "Эспрессо", typeId: 1, categoryId: 1, price: 180, cost: 25.2, recipe },
  { id: 4, name: "Гранатовый тоник", typeId: 1, categoryId: 2, price: 300, cost: 42, recipe: [{ ingredientName: "Гранатовый сок", quantity: 100, quantityUnit: "ml", unlinked: true }] },
  { id: 5, name: "Круассан с миндалём", typeId: 2, categoryId: 4, price: 290, cost: 115, recipe: [] },
  { id: 6, name: "Флэт уайт", typeId: 1, categoryId: 1, price: 260, cost: 51, recipe },
  { id: 7, name: "Апельсиновый фреш", typeId: 1, categoryId: 3, price: 350, cost: 370, recipe: [] },
  { id: 8, name: "Сырники со сметаной", typeId: 2, categoryId: 5, price: 390, cost: 0, recipe: [] },
  { id: 9, name: "Матча на кокосовом молоке", typeId: 1, categoryId: 2, price: 340, cost: 110, hidden: true, recipe: [] },
  { id: 10, name: "Лимонад манго-маракуйя", typeId: 1, categoryId: 3, price: 300, cost: 75, recipe: [] },
  { id: 11, name: "Круассан с лососем и сливочным сыром", typeId: 2, categoryId: 4, price: 450, cost: 185, recipe: [] },
  { id: 12, name: "Дополнительный шот эспрессо", typeId: 1, categoryId: 1, price: 70, cost: 15, isExtra: true, recipe },
].map((product) => ({ ...product, category: categories.find((c) => c.id === product.categoryId).name, typeName: types.find((t) => t.id === product.typeId).name }));
const sales = [141, 98, 124, 47, 65, 42, 18, 0, 0, 24, 0, 36].map((qty, index) => {
  const product = products[index];
  return { id: index + 1, createdAt: new Date().toISOString(), items: [{ productId: product.id, name: product.name, qty, price: product.price, cost: product.cost, total: product.price * qty }] };
}).filter((sale) => sale.items[0].qty > 0);

export function workPreviewResponse(url) {
  if (url.includes("/product-types")) return types;
  if (url.includes("/product-categories")) return categories;
  if (url.includes("/menu-products")) return products;
  if (url.includes("/warehouse/items")) return warehouse;
  if (url.includes("/sales") && !url.includes("/sales/")) return sales;
  return null;
}
