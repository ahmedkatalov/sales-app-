package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// GET /analytics/employees?from=&to=
// BI-агрегат по продавцам: лидерборд + общие KPI + тренд по дням/часам/дням недели.
// Все запросы скоупятся по account_id и фильтруются по локальной дате
// (date(...,'localtime')), чтобы совпадать с часовым поясом магазина.
// Управленческий отчёт — доступ только владельцу/админу (см. requireManager).
func getEmployeeAnalytics(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	from := c.Query("from")
	to := c.Query("to")

	where := []string{"s.account_id = ?"}
	args := []any{accID}
	if from != "" {
		where = append(where, "date(s.created_at,'localtime') >= date(?)")
		args = append(args, from)
	}
	if to != "" {
		where = append(where, "date(s.created_at,'localtime') <= date(?)")
		args = append(args, to)
	}
	cond := strings.Join(where, " AND ")

	// ── Общие KPI + разбивка по способу оплаты ──
	var revenue, cash, transfer, debt, discounts float64
	var orders int
	_ = db.QueryRow(`
		SELECT IFNULL(SUM(total),0), COUNT(*),
		       IFNULL(SUM(CASE WHEN payment_type='cash' THEN total ELSE 0 END),0),
		       IFNULL(SUM(CASE WHEN payment_type='transfer' THEN total ELSE 0 END),0),
		       IFNULL(SUM(CASE WHEN payment_type='debt' THEN total ELSE 0 END),0),
		       IFNULL(SUM(discount_amount),0)
		FROM sales s WHERE `+cond, args...).Scan(&revenue, &orders, &cash, &transfer, &debt, &discounts)

	var itemsSold float64
	_ = db.QueryRow(`SELECT IFNULL(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE `+cond, args...).Scan(&itemsSold)

	aov := 0.0
	if orders > 0 {
		aov = revenue / float64(orders)
	}

	// ── Кол-во проданных товаров по продавцу (отдельным запросом) ──
	itemsByEmp := map[int]float64{}
	if rows, err := db.Query(`SELECT s.employee_id, IFNULL(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE `+cond+` GROUP BY s.employee_id`, args...); err == nil {
		for rows.Next() {
			var eid int
			var q float64
			_ = rows.Scan(&eid, &q)
			itemsByEmp[eid] = q
		}
		rows.Close()
	}

	// ── Лидерборд продавцов ──
	employees := []gin.H{}
	if rows, err := db.Query(`
		SELECT s.employee_id, IFNULL(e.name,''), IFNULL(e.created_at,''),
		       IFNULL(SUM(s.total),0), COUNT(*),
		       IFNULL(SUM(CASE WHEN s.payment_type='cash' THEN s.total ELSE 0 END),0),
		       IFNULL(SUM(CASE WHEN s.payment_type='transfer' THEN s.total ELSE 0 END),0),
		       IFNULL(SUM(CASE WHEN s.payment_type='debt' THEN s.total ELSE 0 END),0),
		       IFNULL(SUM(s.discount_amount),0),
		       IFNULL(MAX(s.total),0), IFNULL(MAX(s.created_at),'')
		FROM sales s
		LEFT JOIN employees e ON e.id = s.employee_id AND e.account_id = s.account_id
		WHERE `+cond+`
		GROUP BY s.employee_id
		ORDER BY SUM(s.total) DESC`, args...); err == nil {
		for rows.Next() {
			var eid, eOrders int
			var name, hireDate, lastSaleAt string
			var eRev, eCash, eTransfer, eDebt, eDisc, eBiggest float64
			if err := rows.Scan(&eid, &name, &hireDate, &eRev, &eOrders, &eCash, &eTransfer, &eDebt, &eDisc, &eBiggest, &lastSaleAt); err != nil {
				continue
			}
			if strings.TrimSpace(name) == "" {
				name = "Без продавца"
			}
			eAov := 0.0
			if eOrders > 0 {
				eAov = eRev / float64(eOrders)
			}
			share := 0.0
			if revenue > 0 {
				share = eRev / revenue * 100
			}
			employees = append(employees, gin.H{
				"id": eid, "name": name, "hireDate": hireDate,
				"revenue": eRev, "orders": eOrders, "aov": eAov,
				"cash": eCash, "transfer": eTransfer, "debt": eDebt,
				"discounts": eDisc, "itemsSold": itemsByEmp[eid],
				"biggestSale": eBiggest, "lastSaleAt": lastSaleAt,
				"share": share,
			})
		}
		rows.Close()
	}

	// ── Тренд по дням ──
	trend := []gin.H{}
	if rows, err := db.Query(`SELECT date(s.created_at,'localtime') d, IFNULL(SUM(total),0), COUNT(*) FROM sales s WHERE `+cond+` GROUP BY d ORDER BY d`, args...); err == nil {
		for rows.Next() {
			var d string
			var rev float64
			var ord int
			_ = rows.Scan(&d, &rev, &ord)
			trend = append(trend, gin.H{"date": d, "revenue": rev, "orders": ord})
		}
		rows.Close()
	}

	// ── По часам (0..23) ──
	byHour := make([]float64, 24)
	byHourOrders := make([]int, 24)
	if rows, err := db.Query(`SELECT CAST(strftime('%H', s.created_at, 'localtime') AS INTEGER) h, IFNULL(SUM(total),0), COUNT(*) FROM sales s WHERE `+cond+` GROUP BY h`, args...); err == nil {
		for rows.Next() {
			var h, ord int
			var rev float64
			_ = rows.Scan(&h, &rev, &ord)
			if h >= 0 && h < 24 {
				byHour[h] = rev
				byHourOrders[h] = ord
			}
		}
		rows.Close()
	}
	hours := make([]gin.H, 24)
	for h := 0; h < 24; h++ {
		hours[h] = gin.H{"hour": h, "revenue": byHour[h], "orders": byHourOrders[h]}
	}

	// ── По дням недели (0=Вс..6=Сб, как strftime('%w')) ──
	weekday := make([]float64, 7)
	if rows, err := db.Query(`SELECT CAST(strftime('%w', s.created_at, 'localtime') AS INTEGER) w, IFNULL(SUM(total),0) FROM sales s WHERE `+cond+` GROUP BY w`, args...); err == nil {
		for rows.Next() {
			var w int
			var rev float64
			_ = rows.Scan(&w, &rev)
			if w >= 0 && w < 7 {
				weekday[w] = rev
			}
		}
		rows.Close()
	}
	weekdays := make([]gin.H, 7)
	for w := 0; w < 7; w++ {
		weekdays[w] = gin.H{"weekday": w, "revenue": weekday[w]}
	}

	c.JSON(http.StatusOK, gin.H{
		"totals": gin.H{
			"revenue": revenue, "orders": orders, "aov": aov,
			"cash": cash, "transfer": transfer, "debt": debt,
			"discounts": discounts, "itemsSold": itemsSold,
			"activeEmployees": len(employees),
		},
		"employees": employees,
		"trend":     trend,
		"byHour":    hours,
		"byWeekday": weekdays,
	})
}
