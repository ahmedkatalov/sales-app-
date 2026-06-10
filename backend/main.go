package main

import (
	"database/sql"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/mattn/go-sqlite3"
	"log"
	"os"
	"strings"
)

func main() {
	if err := os.MkdirAll("./data", os.ModePerm); err != nil {
		log.Fatal(err)
	}

	var err error
	db, err = sql.Open("sqlite3", "file:./data/app.db?_busy_timeout=10000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}

	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;`); err != nil {
		log.Fatal(err)
	}

	createTables()
	initEmailJS()

	r := gin.Default()

	allowedOrigins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))

	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Owner-Account-ID", "X-Data-Account-ID", "X-Super-Token", "X-Requested-With"},
		AllowCredentials: true,
	}))

	// ---------------------------------------------------------------------------
	// Публичные маршруты — только логин и выход
	// Регистрация убрана из публичного доступа!
	// ---------------------------------------------------------------------------
	r.POST("/auth/login", login)
	r.POST("/auth/login-otp/request", requestLoginOTP)
	r.POST("/auth/login-otp/confirm", confirmLoginOTP)

	// ---------------------------------------------------------------------------
	// Super-admin маршруты — защищены токеном SUPER_ADMIN_TOKEN из .env
	// Используются только тобой для создания компаний (аккаунтов)
	// ---------------------------------------------------------------------------
	super := r.Group("/super", superAdminRequired())
	super.GET("/accounts", superListAccounts)
	super.POST("/accounts", superCreateAccount)
	super.DELETE("/accounts/:id", superDeleteAccount)

	// ---------------------------------------------------------------------------
	// Защищённые маршруты — все запросы проверяются через authRequired()
	// ---------------------------------------------------------------------------
	auth := r.Group("/", authRequired())

	auth.POST("/auth/logout", logout)

	auth.GET("/workspaces", getWorkspaces)
	auth.POST("/workspaces", createWorkspace)
	auth.DELETE("/workspaces/:id", deleteWorkspace)

	auth.GET("/workspace-users", getWorkspaceUsers)
	auth.POST("/workspace-users", createWorkspaceUser)
	auth.DELETE("/workspace-users/:id", deleteWorkspaceUser)

	auth.GET("/employees", getEmployees)
	auth.POST("/employees", createEmployee)
	auth.DELETE("/employees/:id", deleteEmployee)

	auth.GET("/cards", getCards)
	auth.POST("/cards", createCard)
	auth.DELETE("/cards/:id", deleteCard)

	auth.GET("/product-types", getProductTypes)
	auth.POST("/product-types", createProductType)
	auth.DELETE("/product-types/:id", deleteProductType)

	auth.GET("/product-categories", getProductCategories)
	auth.POST("/product-categories", createProductCategory)
	auth.DELETE("/product-categories/:id", deleteProductCategory)

	auth.GET("/warehouse/items", getWarehouseItems)
	auth.GET("/warehouse/deleted-items", getDeletedWarehouseItems)
	auth.POST("/warehouse/items", createWarehouseItem)
	auth.GET("/warehouse/items/similar", getSimilarWarehouseItems)
	auth.POST("/ai/warehouse/parse", parseWarehousePurchaseAI)
	auth.POST("/ai/intent", detectIntent)
	auth.POST("/ai/warehouse/ask", askWarehouseAI)
	auth.POST("/ai/expense/parse", parseExpenseAI)
	auth.POST("/ai/menu/parse", parseMenuProductAI)
	auth.POST("/ai/menu/suggest", suggestMenuProduct)
	auth.POST("/warehouse/items/:id/purchase", purchaseWarehouseItem)
	auth.PUT("/warehouse/items/:id", updateWarehouseItem)
	auth.DELETE("/warehouse/items/:id", deleteWarehouseItem)
	auth.DELETE("/warehouse/items/:id/last-purchase", deleteLastWarehousePurchase)
	auth.GET("/warehouse/movements", getWarehouseMovements)
	auth.GET("/warehouse/items/:id/batches", getWarehouseBatches)
	auth.POST("/warehouse/items/:id/writeoff", writeOffWarehouseItem)
	auth.POST("/warehouse/items/:id/hide", hideWarehouseItem)

	auth.GET("/menu-products", getMenuProducts)
	auth.POST("/menu-products", createMenuProduct)
	auth.PUT("/menu-products/:id", updateMenuProduct)
	auth.DELETE("/menu-products/:id", deleteMenuProduct)

	auth.POST("/sales", createSale)
	auth.GET("/sales", getSales)
	auth.GET("/sales/stats", getSalesStats)
	auth.GET("/pending-sales", getPendingSales)
	auth.POST("/pending-sales", createPendingSale)
	auth.POST("/pending-sales/:id/confirm", confirmPendingSale)
	auth.DELETE("/pending-sales/:id", deletePendingSale)
	auth.GET("/debt-customers", getDebtCustomers)
	auth.GET("/debts", getDebts)
	auth.POST("/debts/:id/close", closeDebt)
	auth.DELETE("/debts/history", clearDebtHistory)

	auth.GET("/global-expenses", getGlobalExpenses)
	auth.POST("/global-expenses", createGlobalExpense)
	auth.DELETE("/global-expenses/:id", deleteGlobalExpense)

	auth.GET("/expenses/:folderId/:monthId", getExpenses)
	auth.POST("/expenses", addExpense)
	auth.DELETE("/expenses/:id", deleteExpense)

	auth.GET("/folders", getFolders)
	auth.POST("/folders", createFolder)

	auth.GET("/months/:folderId", getMonths)
	auth.POST("/months", createMonth)
	auth.POST("/months/copy-items", copyItemsToMonth)

	auth.GET("/items/:monthId", getItems)
	auth.POST("/items", addItem)
	auth.PUT("/items/:id", updateItem)
	auth.DELETE("/items/:id", deleteItem)

	log.Println("Backend started on http://localhost:3000")
	r.Run(":3000")
}

func parseAllowedOrigins(env string) []string {
	env = strings.TrimSpace(env)
	if env == "" {
		return []string{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:5174",
			"http://127.0.0.1:5174",
			"http://localhost:5177",
			"http://127.0.0.1:5177",
		}
	}
	parts := strings.Split(env, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}
