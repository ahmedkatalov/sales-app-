package main

import "testing"

func TestNormalizePurchaseQuantityPieceToGrams(t *testing.T) {
	item := WarehouseItem{
		Unit:              "g",
		PurchaseUnit:      "pcs",
		Quantity:          5,
		PackagingQuantity: 100,
		MinQuantity:       10,
	}

	unit, quantity, minQuantity, _, err := normalizePurchaseQuantity(item, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if unit != "g" || quantity != 500 || minQuantity != 10 {
		t.Fatalf("expected 500 g and min 10, got %.2f %s min %.2f", quantity, unit, minQuantity)
	}
}

func TestNormalizePurchaseQuantityKilogramsToGrams(t *testing.T) {
	item := WarehouseItem{
		Unit:         "g",
		PurchaseUnit: "kg",
		Quantity:     2,
		MinQuantity:  0.5,
	}

	unit, quantity, minQuantity, _, err := normalizePurchaseQuantity(item, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if unit != "g" || quantity != 2000 || minQuantity != 0.5 {
		t.Fatalf("expected 2000 g, got %.2f %s min %.2f", quantity, unit, minQuantity)
	}
}

func TestNormalizePurchaseQuantityLitersToMilliliters(t *testing.T) {
	item := WarehouseItem{
		Unit:         "ml",
		PurchaseUnit: "l",
		Quantity:     1.5,
		MinQuantity:  100,
	}

	unit, quantity, minQuantity, _, err := normalizePurchaseQuantity(item, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if unit != "ml" || quantity != 1500 || minQuantity != 100 {
		t.Fatalf("expected 1500 ml, got %.2f %s min %.2f", quantity, unit, minQuantity)
	}
}

func TestNormalizePurchaseQuantityRejectsMissingPackageSize(t *testing.T) {
	item := WarehouseItem{
		Unit:         "g",
		PurchaseUnit: "pcs",
		Quantity:     5,
	}

	_, quantity, _, _, err := normalizePurchaseQuantity(item, "")
	if err == nil || quantity != 0 {
		t.Fatalf("expected error and zero quantity, got quantity %.2f err %v", quantity, err)
	}
}
