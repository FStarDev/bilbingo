import { resolve } from "node:path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

function getIsoWeekPeriod(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);

  const seasonYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(seasonYear, 0, 1));
  const seasonWeek = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return { seasonYear, seasonWeek };
}

const dbPath = resolve("backend", "data", "bilbingo.sqlite");
const db = await open({ filename: dbPath, driver: sqlite3.Database });

const now = new Date();
const targetDates = [1, 2].map((daysAgo) => {
  const d = new Date(now);
  d.setDate(now.getDate() - daysAgo);
  return d;
});

let insertedSales = 0;
let insertedItems = 0;

await db.exec("BEGIN");
try {
  for (const dateObj of targetDates) {
    const date = dateObj.toISOString().slice(0, 10);
    const occasionId = `mock-occ-${date}`;
    const createdAt = new Date(`${date}T17:00:00`).getTime();
    const closedAt = new Date(`${date}T21:00:00`).getTime();

    await db.run(
      `INSERT OR REPLACE INTO occasions (id, date, open, created_at, closed_at) VALUES (?, ?, 0, ?, ?)`,
      occasionId,
      date,
      createdAt,
      closedAt,
    );

    const mockSales = [
      {
        id: `mock-${date}-1`,
        salespersonName: "Anna",
        cashierNumber: 1,
        saleTimestamp: new Date(`${date}T17:25:00`).getTime(),
        items: [
          { id: "storbingo", name: "Storbingo", unitPrice: 50, quantity: 2 },
          { id: "rovaren", name: "Rövaren", unitPrice: 20, quantity: 1 },
        ],
      },
      {
        id: `mock-${date}-2`,
        salespersonName: "Erik",
        cashierNumber: 2,
        saleTimestamp: new Date(`${date}T18:10:00`).getTime(),
        items: [
          { id: "freeplay", name: "Freeplay", unitPrice: 20, quantity: 3 },
          { id: "fiftyfifty", name: "Fifty/Fifty", unitPrice: 20, quantity: 1 },
        ],
      },
      {
        id: `mock-${date}-3`,
        salespersonName: "Sara",
        cashierNumber: 3,
        saleTimestamp: new Date(`${date}T19:05:00`).getTime(),
        items: [
          { id: "storbingo", name: "Storbingo", unitPrice: 50, quantity: 1 },
          { id: "freeplay", name: "Freeplay", unitPrice: 20, quantity: 2 },
          { id: "rovaren", name: "Rövaren", unitPrice: 20, quantity: 1 },
        ],
      },
    ];

    for (const sale of mockSales) {
      const period = getIsoWeekPeriod(new Date(sale.saleTimestamp));
      const normalizedItems = sale.items.map((item) => ({
        ...item,
        amount: item.unitPrice * item.quantity,
      }));
      const totalItems = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalPrice = normalizedItems.reduce((sum, item) => sum + item.amount, 0);

      await db.run(`DELETE FROM sale_items WHERE sale_id = ?`, sale.id);
      await db.run(`DELETE FROM sales WHERE id = ?`, sale.id);

      await db.run(
        `
          INSERT INTO sales (
            id,
            salesperson_name,
            cashier_number,
            season_year,
            season_week,
            occasion_id,
            total_items,
            total_price,
            sale_timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        sale.id,
        sale.salespersonName,
        sale.cashierNumber,
        period.seasonYear,
        period.seasonWeek,
        occasionId,
        totalItems,
        totalPrice,
        sale.saleTimestamp,
      );

      for (const item of normalizedItems) {
        await db.run(
          `
            INSERT INTO sale_items (
              sale_id,
              item_id,
              item_name,
              unit_price,
              quantity,
              amount
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          sale.id,
          item.id,
          item.name,
          item.unitPrice,
          item.quantity,
          item.amount,
        );
        insertedItems += 1;
      }

      insertedSales += 1;
    }
  }

  await db.exec("COMMIT");

  const check = await db.all(`
    SELECT o.date AS date, COUNT(s.id) AS salesCount, COALESCE(SUM(s.total_price), 0) AS revenue
    FROM occasions o
    LEFT JOIN sales s ON s.occasion_id = o.id
    WHERE o.id LIKE 'mock-occ-%'
    GROUP BY o.date
    ORDER BY o.date DESC
    LIMIT 2
  `);

  console.log(`Seed complete in ${dbPath}`);
  console.log(`Inserted sales: ${insertedSales}`);
  console.log(`Inserted sale items: ${insertedItems}`);
  console.log("Summary:", check);
} catch (error) {
  await db.exec("ROLLBACK");
  throw error;
} finally {
  await db.close();
}
