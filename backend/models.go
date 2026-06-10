package main

import "database/sql"

type Account struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

type Workspace struct {
	ID            int    `json:"id"`
	AccountID     int    `json:"accountId"`
	DataAccountID int    `json:"dataAccountId"`
	Name          string `json:"name"`
	IsMain        bool   `json:"isMain"`
	CreatedAt     string `json:"createdAt"`
}

type User struct {
	ID                 int    `json:"id"`
	AccountID          int    `json:"accountId"`
	OwnerAccountID     int    `json:"ownerAccountId"`
	WorkspaceID        int    `json:"workspaceId"`
	DataAccountID      int    `json:"dataAccountId"`
	DefaultWorkspaceID int    `json:"defaultWorkspaceId"`
	Username           string `json:"username"`
	Password           string `json:"password,omitempty"`
	Role               string `json:"role"`
	WorkspaceName      string `json:"workspaceName"`
	OwnerName          string `json:"ownerName"`
}

type Employee struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`
}

type Card struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`
	Owner     string `json:"owner"`
}

type ProductType struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`
}

type ProductCategory struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`
	TypeID    int    `json:"typeId"`
	TypeName  string `json:"typeName"`
	Type      string `json:"type"`
}

type ProductRecipe struct {
	ID                   int     `json:"id"`
	ProductID            int     `json:"productId"`
	WarehouseItemID      int     `json:"warehouseItemId"`
	WarehouseItemIDSnake int     `json:"warehouse_item_id"`
	ItemName             string  `json:"itemName"`
	IngredientName       string  `json:"ingredientName"`
	Unlinked             bool    `json:"unlinked"`
	Unit                 string  `json:"unit"`
	Quantity             float64 `json:"quantity"`
	QuantityUnit         string  `json:"quantityUnit"`
	QuantityUnitSnake    string  `json:"quantity_unit"`
	StorageQuantity      float64 `json:"storageQuantity"`
	ConversionNote       string  `json:"conversionNote"`
	UnitCost             float64 `json:"unitCost"`
	Cost                 float64 `json:"cost"`

	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Fat      float64 `json:"fat"`
	Carbs    float64 `json:"carbs"`
}

type WarehouseItem struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`

	Unit     string  `json:"unit"`
	Quantity float64 `json:"quantity"`

	Price    float64 `json:"price"`
	UnitCost float64 `json:"unitCost"`

	Supplier    string  `json:"supplier"`
	ExpiryDate  string  `json:"expiryDate"`
	MinQuantity float64 `json:"minQuantity"`
	Note        string  `json:"note"`
	Hidden      bool    `json:"hidden"`
	CreatedAt   string  `json:"createdAt"`

	ControlMode     string  `json:"controlMode"`
	LossPercent     float64 `json:"lossPercent"`
	InventoryMethod string  `json:"inventoryMethod"`

	PurchaseUnit      string `json:"purchaseUnit"`
	PurchaseUnitSnake string `json:"purchase_unit"`

	PackagingQuantity float64 `json:"packagingQuantity"`

	PackageItems      float64 `json:"packageItems"`
	PackageItemsSnake float64 `json:"package_items"`

	ItemSize      float64 `json:"itemSize"`
	ItemSizeSnake float64 `json:"item_size"`

	ItemUnit      string `json:"itemUnit"`
	ItemUnitSnake string `json:"item_unit"`

	CaloriesPerUnit float64 `json:"caloriesPerUnit"`
	ProteinPerUnit  float64 `json:"proteinPerUnit"`
	FatPerUnit      float64 `json:"fatPerUnit"`
	CarbsPerUnit    float64 `json:"carbsPerUnit"`
}

type WarehouseMovement struct {
	ID                   int     `json:"id"`
	AccountID            int     `json:"accountId"`
	WarehouseItemID      int     `json:"warehouseItemId"`
	WarehouseItemIDSnake int     `json:"warehouse_item_id"`
	ItemName             string  `json:"itemName"`
	Unit                 string  `json:"unit"`
	MovementType         string  `json:"movementType"`
	Quantity             float64 `json:"quantity"`
	Reason               string  `json:"reason"`
	Note                 string  `json:"note"`
	CreatedAt            string  `json:"createdAt"`
}

type MenuProduct struct {
	ID              int             `json:"id"`
	AccountID       int             `json:"accountId"`
	CategoryID      int             `json:"categoryId"`
	CategoryIDSnake int             `json:"category_id"`
	TypeID          int             `json:"typeId"`
	Name            string          `json:"name"`
	Category        string          `json:"category"`
	Type            string          `json:"type"`
	TypeName        string          `json:"typeName"`
	Price           float64         `json:"price"`
	Cost            float64         `json:"cost"`
	CostMode        string          `json:"costMode"`
	Recipe          []ProductRecipe `json:"recipe"`

	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Fat      float64 `json:"fat"`
	Carbs    float64 `json:"carbs"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
}

type SaleItem struct {
	ProductID      int     `json:"productId"`
	ProductIDSnake int     `json:"product_id"`
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	Qty            float64 `json:"qty"`
	Price          float64 `json:"price"`
	Cost           float64 `json:"cost"`
	Total          float64 `json:"total"`
}

type Sale struct {
	ID              int        `json:"id"`
	AccountID       int        `json:"accountId"`
	EmployeeID      int        `json:"employeeId"`
	EmployeeName    string     `json:"employeeName"`
	PaymentType     string     `json:"paymentType"`
	CardID          int        `json:"cardId"`
	CardName        string     `json:"cardName"`
	Subtotal        float64    `json:"subtotal"`
	DiscountPercent float64    `json:"discountPercent"`
	DiscountAmount  float64    `json:"discountAmount"`
	Total           float64    `json:"total"`
	CashGiven       float64    `json:"cashGiven"`
	ChangeAmount    float64    `json:"changeAmount"`
	CreatedAt       string     `json:"createdAt"`
	CustomerName    string     `json:"customerName"`
	Items           []SaleItem `json:"items"`
}

type PendingSale struct {
	Sale
}

type DebtCustomer struct {
	ID        int     `json:"id"`
	AccountID int     `json:"accountId"`
	Name      string  `json:"name"`
	DebtTotal float64 `json:"debtTotal"`
	CreatedAt string  `json:"createdAt"`
}

type DebtRecord struct {
	ID           int        `json:"id"`
	AccountID    int        `json:"accountId"`
	CustomerID   int        `json:"customerId"`
	CustomerName string     `json:"customerName"`
	SaleID       int        `json:"saleId"`
	Amount       float64    `json:"amount"`
	Status       string     `json:"status"`
	CreatedAt    string     `json:"createdAt"`
	PaidAt       string     `json:"paidAt"`
	Items        []SaleItem `json:"items"`
}

type GlobalExpense struct {
	ID           int     `json:"id"`
	AccountID    int     `json:"accountId"`
	EmployeeID   int     `json:"employeeId"`
	EmployeeName string  `json:"employeeName"`
	Category     string  `json:"category"`
	Type         string  `json:"type"`
	Name         string  `json:"name"`
	Amount       float64 `json:"amount"`
	Comment      string  `json:"comment"`
	CreatedAt    string  `json:"createdAt"`
}

type Expense struct {
	ID       int     `json:"id"`
	FolderID int     `json:"folderId"`
	MonthID  int     `json:"monthId"`
	Category string  `json:"category"`
	Type     string  `json:"type"`
	SubType  string  `json:"subType"`
	Name     string  `json:"name"`
	Qty      float64 `json:"qty"`
	Price    float64 `json:"price"`
	Amount   float64 `json:"amount"`
	Comment  string  `json:"comment"`
}

type Folder struct {
	ID        int    `json:"id"`
	AccountID int    `json:"accountId"`
	Name      string `json:"name"`
}

type Month struct {
	ID       int    `json:"id"`
	FolderID int    `json:"folderId"`
	Month    string `json:"month"`
}

type Item struct {
	ID       int     `json:"id"`
	FolderID int     `json:"folderId"`
	MonthID  int     `json:"monthId"`
	Name     string  `json:"name"`
	Cost     float64 `json:"cost"`
	Price    float64 `json:"price"`
	Qty      float64 `json:"qty"`
}

type AIAssistantRequest struct {
	Text  string `json:"text"`
	Mode  string `json:"mode"`
	Action string `json:"action"`
}

type AIAssistantResponse struct {
	Message       string              `json:"message"`
	Status        string              `json:"status"`
	Questions     []string            `json:"questions"`
	Actions       []AIAssistantAction `json:"actions"`
	NeedConfirm   bool                `json:"needConfirm"`
	ConfirmToken  string              `json:"confirmToken"`
}

type AIAssistantAction struct {
	Type        string  `json:"type"`
	Name        string  `json:"name"`
	Quantity    float64 `json:"quantity"`
	Unit        string  `json:"unit"`
	Price       float64 `json:"price"`
	Amount      float64 `json:"amount"`
	TargetID    int     `json:"targetId"`
	Description string  `json:"description"`
}

var db *sql.DB