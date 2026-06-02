import cors from "cors";
import express, { type Request, type Response } from "express";
import { existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";

type ItemId = "storbingo" | "rovaren" | "freeplay" | "fiftyfifty";

type SaleItemInput = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
};

type SalePayload = {
  id?: string;
  salespersonName: string;
  cashierNumber: number;
  saleTimestamp?: number;
  items: SaleItemInput[];
};

type AdminLoginPayload = {
  pin: string;
};

type StatsScope = "week" | "season" | "all" | "occasion" | "current_occasion" | "year" | "today";

type Period = {
  seasonYear: number;
  seasonWeek: number;
};

type ProductSummary = {
  id: string;
  name: string;
  quantity: number;
  amount: number;
};

type Occasion = {
  id: string;
  date: string; // YYYY-MM-DD
  open: number; // 0 or 1
  createdAt: number;
  closedAt?: number | null;
};

const DEFAULT_PORT = 8787;
const ADMIN_PIN = process.env.BILBINGO_ADMIN_PIN ?? "909";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = resolve(__dirname, "..");
const projectRoot = resolve(backendRoot, "..");
const dataDir = resolve(backendRoot, "data");
const databasePath = resolve(dataDir, "bilbingo.sqlite");
const frontendDistDir = resolve(projectRoot, "dist");
const frontendIndexPath = resolve(frontendDistDir, "index.html");

function getIsoWeekPeriod(date: Date): Period {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);

  const seasonYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(seasonYear, 0, 1));
  const seasonWeek = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return { seasonYear, seasonWeek };
}

function getCurrentPeriod(): Period {
  return getIsoWeekPeriod(new Date());
}

function isItemId(value: string): value is ItemId {
  return value === "storbingo" || value === "rovaren" || value === "freeplay" || value === "fiftyfifty";
}

function parseSalePayload(body: unknown): SalePayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Partial<SalePayload>;
  if (!candidate.salespersonName || typeof candidate.salespersonName !== "string") {
    return null;
  }

  if (typeof candidate.cashierNumber !== "number" || candidate.cashierNumber < 1 || candidate.cashierNumber > 3) {
    return null;
  }

  if (!Array.isArray(candidate.items)) {
    return null;
  }

  const items = candidate.items.filter((item): item is SaleItemInput => {
    return Boolean(
      item &&
      typeof item === "object" &&
      isItemId((item as SaleItemInput).id) &&
      typeof (item as SaleItemInput).name === "string" &&
      typeof (item as SaleItemInput).price === "number" &&
      typeof (item as SaleItemInput).quantity === "number"
    );
  });

  if (items.length !== candidate.items.length) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id.trim() : undefined,
    salespersonName: candidate.salespersonName.trim(),
    cashierNumber: candidate.cashierNumber,
    saleTimestamp: typeof candidate.saleTimestamp === "number" ? candidate.saleTimestamp : undefined,
    items,
  };
}

function parseAdminLoginPayload(body: unknown): AdminLoginPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Partial<AdminLoginPayload>;
  if (typeof candidate.pin !== "string") {
    return null;
  }

  return { pin: candidate.pin.trim() };
}

function parseScope(raw: unknown): StatsScope {
  if (raw === "season" || raw === "all" || raw === "week" || raw === "occasion" || raw === "current_occasion" || raw === "year" || raw === "today") {
    return raw as StatsScope;
  }
  return "week";
}

function parseCashierNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "all") {
    return null;
  }

  const cashierNumber = Number(raw);
  if (!Number.isInteger(cashierNumber) || cashierNumber < 1 || cashierNumber > 3) {
    return null;
  }
  return cashierNumber;
}

function getConnectUrls(protocol: "http" | "https", port: number, path: string): string[] {
  const allInterfaces = networkInterfaces();
  const hosts = new Set<string>();

  hosts.add("localhost");
  hosts.add(hostname().toLowerCase());

  for (const interfaceEntries of Object.values(allInterfaces)) {
    for (const details of interfaceEntries ?? []) {
      if (!details || details.internal) {
        continue;
      }

      if (details.family === "IPv4") {
        hosts.add(details.address);
      }
    }
  }

  const normalizedPath = path.startsWith("/") ? path : "/";
  const hidePort = (protocol === "http" && port === 80) || (protocol === "https" && port === 443);
  const portPart = hidePort ? "" : `:${port}`;

  return Array.from(hosts)
    .map((entry) => `/${entry}`)
    .sort((left, right) => left.localeCompare(right, "sv"))
    .map((entry) => `${protocol}:/${entry}${portPart}${normalizedPath}`);
}

function buildSalesWhere(scope: StatsScope, cashierNumber: number | null, period: Period, occasionId?: string | null): { whereSql: string; params: Array<any> } {
  const clauses: string[] = [];
  const params: Array<any> = [];

  if (scope === "week") {
    clauses.push("s.season_year = ?", "s.season_week = ?");
    params.push(period.seasonYear, period.seasonWeek);
  } else if (scope === "season") {
    clauses.push("s.season_year = ?");
    params.push(period.seasonYear);
  } else if (scope === "year") {
    clauses.push("s.season_year = ?");
    params.push(period.seasonYear);
  } else if (scope === "today") {
    const today = new Date().toISOString().slice(0, 10);
    clauses.push("date(s.sale_timestamp / 1000, 'unixepoch', 'localtime') = ?");
    params.push(today);
  } else if (scope === "current_occasion") {
    // filter by currently open occasion
    clauses.push("s.occasion_id = (SELECT id FROM occasions WHERE open = 1 LIMIT 1)");
  } else if (scope === "occasion") {
    if (occasionId) {
      clauses.push("s.occasion_id = ?");
      params.push(occasionId);
    } else {
      // no occasion specified -> match nothing
      clauses.push("0 = 1");
    }
  }

  if (cashierNumber !== null) {
    clauses.push("s.cashier_number = ?");
    params.push(cashierNumber);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function getBearerToken(request: Request): string | null {
  const authorization = request.header("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

async function createAdminSession(db: Database): Promise<string> {
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const now = Date.now();
  const expiresAt = now + ADMIN_SESSION_TTL_MS;

  await db.run(
    `
      INSERT INTO admin_sessions (
        token,
        created_at,
        expires_at,
        revoked
      ) VALUES (?, ?, ?, 0)
    `,
    token,
    now,
    expiresAt,
  );

  return token;
}

async function requireAdmin(request: Request, response: Response, db: Database): Promise<boolean> {
  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Admin authentication required." });
    return false;
  }

  const session = await db.get<{ token: string }>(
    `
      SELECT token
      FROM admin_sessions
      WHERE token = ? AND revoked = 0 AND expires_at > ?
    `,
    token,
    Date.now(),
  );

  if (!session) {
    response.status(401).json({ error: "Admin session invalid or expired." });
    return false;
  }

  return true;
}

async function ensureDatabase(): Promise<Database> {
  await mkdir(dataDir, { recursive: true });
  // If requested, remove existing DB to start fresh (useful in testing/deploy)
  const resetDb = String(process.env.BILBINGO_RESET_DB ?? "").toLowerCase();
  if (resetDb === "1" || resetDb === "true") {
    if (existsSync(databasePath)) {
      try {
        unlinkSync(databasePath);
        console.log("Bilbingo: existing database removed due to BILBINGO_RESET_DB");
      } catch (err) {
        console.warn("Bilbingo: failed to remove existing database:", err);
      }
    }
  }
  const db = await open({
    filename: databasePath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      salesperson_name TEXT NOT NULL,
      cashier_number INTEGER NOT NULL CHECK(cashier_number BETWEEN 1 AND 3),
      season_year INTEGER NOT NULL,
      season_week INTEGER NOT NULL,
      occasion_id TEXT,
      total_items INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      sale_timestamp INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sales_period ON sales(season_year, season_week);
    CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_number);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
    
    CREATE TABLE IF NOT EXISTS occasions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      open INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      closed_at INTEGER
    );
  `);

  // No automatic migration of old data: user may reset DB via BILBINGO_RESET_DB.

  await db.run(
    `
      UPDATE admin_sessions
      SET revoked = 1
      WHERE expires_at <= ?
    `,
    Date.now(),
  );

  return db;
}

async function main() {
  const db = await ensureDatabase();
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      databasePath,
      currentPeriod: getCurrentPeriod(),
    });
  });

  async function closeExpiredOccasions(): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      await db.run(`UPDATE occasions SET open = 0, closed_at = ? WHERE open = 1 AND date < ?`, now, today);
    } catch (err) {
      console.warn("Error closing expired occasions:", err);
    }
  }

  // Close expired occasions on startup and periodically (runs every minute)
  await closeExpiredOccasions();
  setInterval(() => void closeExpiredOccasions(), 60 * 1000);

    app.get("/api/occasions/current", async (_request: Request, response: Response) => {
      const row = await db.get<Occasion>(`
        SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
        FROM occasions
        WHERE open = 1
        ORDER BY date DESC
        LIMIT 1
      `);
      response.json(row ?? null);
    });

    app.get("/api/occasions", async (request: Request, response: Response) => {
      const { date } = request.query;
      if (typeof date === "string" && date.length > 0) {
        const rows = await db.all<Occasion>(`
          SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
          FROM occasions
          WHERE date = ?
          ORDER BY created_at DESC
        `, date);
        response.json(rows);
        return;
      }

      const rows = await db.all<Occasion>(`
        SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
        FROM occasions
        ORDER BY date DESC, created_at DESC
      `);
      response.json(rows);
    });

    app.post("/api/occasions/open", async (request: Request, response: Response) => {
      if (!(await requireAdmin(request, response, db))) {
        return;
      }
      const body = request.body as { date?: string } | undefined;
      const today = typeof body?.date === "string" && body.date.length > 0
        ? body.date
        : new Date().toISOString().slice(0, 10);
      const now = Date.now();

      await db.exec("BEGIN");
      try {
        await db.run(
          `UPDATE occasions SET open = 0, closed_at = ? WHERE open = 1 AND date != ?`,
          now,
          today,
        );

        const existing = await db.get<Occasion>(`
          SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
          FROM occasions
          WHERE date = ?
          LIMIT 1
        `, today);

        if (existing) {
          await db.run(
            `UPDATE occasions SET open = 1, closed_at = NULL WHERE id = ?`,
            existing.id,
          );
        } else {
          await db.run(
            `INSERT INTO occasions (id, date, open, created_at) VALUES (?, ?, 1, ?)`,
            crypto.randomUUID(),
            today,
            now,
          );
        }

        await db.exec("COMMIT");
      } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
      }

      const row = await db.get<Occasion>(`
        SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
        FROM occasions
        WHERE date = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, today);
      response.status(200).json(row ?? null);
    });

    app.post("/api/occasions/:id/close", async (request: Request, response: Response) => {
      if (!(await requireAdmin(request, response, db))) {
        return;
      }

      const { id } = request.params;
      const occasion = await db.get<Occasion>(`
        SELECT id, date, open AS open, created_at AS createdAt, closed_at AS closedAt
        FROM occasions
        WHERE id = ?
      `, id);

      if (!occasion) {
        response.status(404).json({ error: "Occasion not found." });
        return;
      }

      const now = Date.now();
      await db.run(`UPDATE occasions SET open = 0, closed_at = ? WHERE id = ?`, now, id);
      response.status(200).json({ ...occasion, open: 0, closedAt: now });
    });

  app.get("/api/period/current", (_request: Request, response: Response) => {
    response.json(getCurrentPeriod());
  });

  app.get("/api/server/connect-info", (request: Request, response: Response) => {
    const protocol = request.query.protocol === "https" ? "https" : "http";
    const parsedPort = Number(request.query.port);
    const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : 5173;
    const path = typeof request.query.path === "string" && request.query.path.length > 0
      ? request.query.path
      : "/";

    response.json({
      hostName: hostname(),
      urls: getConnectUrls(protocol, port, path),
    });
  });

  app.post("/api/auth/admin/login", async (request: Request, response: Response) => {
    const payload = parseAdminLoginPayload(request.body);
    if (!payload || payload.pin.length === 0) {
      response.status(400).json({ error: "PIN is required." });
      return;
    }

    if (payload.pin !== ADMIN_PIN) {
      response.status(401).json({ error: "Invalid PIN." });
      return;
    }

    const token = await createAdminSession(db);
    response.status(201).json({
      token,
      currentPeriod: getCurrentPeriod(),
      expiresInMs: ADMIN_SESSION_TTL_MS,
    });
  });

  app.post("/api/auth/admin/logout", async (request: Request, response: Response) => {
    const token = getBearerToken(request);
    if (token) {
      await db.run(
        `
          UPDATE admin_sessions
          SET revoked = 1
          WHERE token = ?
        `,
        token,
      );
    }

    response.status(204).end();
  });

  app.post("/api/sales", async (request: Request, response: Response) => {
    const payload = parseSalePayload(request.body);
    if (!payload || payload.salespersonName.length === 0) {
      response.status(400).json({ error: "Invalid sale payload." });
      return;
    }

    const normalizedItems = payload.items
      .map((item) => ({
        id: item.id,
        name: item.name.trim(),
        price: Math.round(item.price),
        quantity: Math.max(0, Math.floor(item.quantity)),
      }))
      .filter((item) => item.quantity > 0);

    if (normalizedItems.length === 0) {
      response.status(400).json({ error: "Sale must contain at least one item." });
      return;
    }

    const saleTimestamp = payload.saleTimestamp ?? Date.now();
    const period = getIsoWeekPeriod(new Date(saleTimestamp));
    const saleId = payload.id ?? crypto.randomUUID();
    const items = normalizedItems.map((item) => ({
      ...item,
      amount: item.price * item.quantity,
    }));
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = items.reduce((sum, item) => sum + item.amount, 0);

    await db.exec("BEGIN");
    try {
      const existingSale = await db.get<{ id: string }>(
        `
          SELECT id
          FROM sales
          WHERE id = ?
        `,
        saleId,
      );

      if (existingSale) {
        await db.exec("ROLLBACK");
        response.status(200).json({
          id: saleId,
          salespersonName: payload.salespersonName.trim(),
          cashierNumber: payload.cashierNumber,
          seasonYear: period.seasonYear,
          seasonWeek: period.seasonWeek,
          saleTimestamp,
          totalItems,
          totalPrice,
          items,
          duplicate: true,
        });
        return;
      }

      const isTest = request.query.test === "1" || request.query.test === "true" || Boolean((request.body as any).test === true);
      if (!isTest) {
        // Ensure there is an open occasion for accepting sales
        const openOccasion = await db.get<{ id: string }>(`SELECT id FROM occasions WHERE open = 1 LIMIT 1`);
        if (!openOccasion) {
          await db.exec("ROLLBACK");
          response.status(403).json({ error: "Sales are currently closed." });
          return;
        }

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
          saleId,
          payload.salespersonName.trim(),
          payload.cashierNumber,
          period.seasonYear,
          period.seasonWeek,
          openOccasion.id,
          totalItems,
          totalPrice,
          saleTimestamp,
        );

        for (const item of items) {
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
            saleId,
            item.id,
            item.name,
            item.price,
            item.quantity,
            item.amount,
          );
        }
      } else {
        // Test mode: don't persist anything, but return a simulated response
        await db.exec("ROLLBACK");
        response.status(200).json({
          id: saleId,
          salespersonName: payload.salespersonName.trim(),
          cashierNumber: payload.cashierNumber,
          seasonYear: period.seasonYear,
          seasonWeek: period.seasonWeek,
          saleTimestamp,
          totalItems,
          totalPrice,
          items,
          test: true,
        });
        return;
      }

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    response.status(201).json({
      id: saleId,
      salespersonName: payload.salespersonName.trim(),
      cashierNumber: payload.cashierNumber,
      seasonYear: period.seasonYear,
      seasonWeek: period.seasonWeek,
      saleTimestamp,
      totalItems,
      totalPrice,
      items,
    });
  });

  app.get("/api/stats/cashier/current", async (request: Request, response: Response) => {
    const cashierNumber = parseCashierNumber(request.query.cashierNumber);
    if (cashierNumber === null) {
      response.status(400).json({ error: "cashierNumber must be 1, 2, or 3." });
      return;
    }

    const period = getCurrentPeriod();
    const totals = await db.get<{
      totalCustomers: number;
      totalRevenue: number;
    }>(
      `
        SELECT
          COUNT(*) AS totalCustomers,
          COALESCE(SUM(total_price), 0) AS totalRevenue
        FROM sales
        WHERE season_year = ? AND season_week = ? AND cashier_number = ?
      `,
      period.seasonYear,
      period.seasonWeek,
      cashierNumber,
    );

    const products = await db.all<ProductSummary[]>(
      `
        SELECT
          si.item_id AS id,
          si.item_name AS name,
          COALESCE(SUM(si.quantity), 0) AS quantity,
          COALESCE(SUM(si.amount), 0) AS amount
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.season_year = ? AND s.season_week = ? AND s.cashier_number = ?
        GROUP BY si.item_id, si.item_name
        ORDER BY si.item_name
      `,
      period.seasonYear,
      period.seasonWeek,
      cashierNumber,
    );

    response.json({
      period,
      cashierNumber,
      totalCustomers: totals?.totalCustomers ?? 0,
      totalRevenue: totals?.totalRevenue ?? 0,
      products,
    });
  });

  app.get("/api/stats/admin", async (request: Request, response: Response) => {
    if (!(await requireAdmin(request, response, db))) {
      return;
    }

    const scope = parseScope(request.query.scope);
    const cashierNumber = parseCashierNumber(request.query.cashierNumber);
    const occasionId = typeof request.query.occasionId === "string" ? request.query.occasionId : undefined;
    const period = getCurrentPeriod();
    const filters = buildSalesWhere(scope, cashierNumber, period, occasionId);

    const totals = await db.get<{
      totalCustomers: number;
      totalRevenue: number;
    }>(
      `
        SELECT
          COUNT(*) AS totalCustomers,
          COALESCE(SUM(s.total_price), 0) AS totalRevenue
        FROM sales s
        ${filters.whereSql}
      `,
      ...filters.params,
    );

    const products = await db.all<ProductSummary[]>(
      `
        SELECT
          si.item_id AS id,
          si.item_name AS name,
          COALESCE(SUM(si.quantity), 0) AS quantity,
          COALESCE(SUM(si.amount), 0) AS amount
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        ${filters.whereSql}
        GROUP BY si.item_id, si.item_name
        ORDER BY si.item_name
      `,
      ...filters.params,
    );

    const cashiers = await db.all<Array<{ cashierNumber: number; customers: number; revenue: number }>>(
      `
        SELECT
          s.cashier_number AS cashierNumber,
          COUNT(*) AS customers,
          COALESCE(SUM(s.total_price), 0) AS revenue
        FROM sales s
        ${filters.whereSql}
        GROUP BY s.cashier_number
        ORDER BY s.cashier_number
      `,
      ...filters.params,
    );

    response.json({
      scope,
      period,
      cashierNumber,
      totalCustomers: totals?.totalCustomers ?? 0,
      totalRevenue: totals?.totalRevenue ?? 0,
      products,
      cashiers,
    });
  });

  app.get("/api/sales-log", async (request: Request, response: Response) => {
    if (!(await requireAdmin(request, response, db))) {
      return;
    }

    const scope = parseScope(request.query.scope);
    const cashierNumber = parseCashierNumber(request.query.cashierNumber);
    const limit = Math.min(500, Math.max(1, Number(request.query.limit ?? 100)));
    const occasionId = typeof request.query.occasionId === "string" ? request.query.occasionId : undefined;
    const period = getCurrentPeriod();
    const filters = buildSalesWhere(scope, cashierNumber, period, occasionId);

    const sales = await db.all<Array<{
      id: string;
      salespersonName: string;
      cashierNumber: number;
      seasonYear: number;
      seasonWeek: number;
      totalItems: number;
      totalPrice: number;
      saleTimestamp: number;
    }>>(
      `
        SELECT
          s.id AS id,
          s.salesperson_name AS salespersonName,
          s.cashier_number AS cashierNumber,
          s.season_year AS seasonYear,
          s.season_week AS seasonWeek,
          s.total_items AS totalItems,
          s.total_price AS totalPrice,
          s.sale_timestamp AS saleTimestamp
        FROM sales s
        ${filters.whereSql}
        ORDER BY s.sale_timestamp DESC
        LIMIT ?
      `,
      ...filters.params,
      limit,
    );

    const salesWithItems = await Promise.all(
      sales.map(async (sale) => {
        const items = await db.all<Array<{
          id: string;
          name: string;
          unitPrice: number;
          quantity: number;
          amount: number;
        }>>(
          `
            SELECT
              item_id AS id,
              item_name AS name,
              unit_price AS unitPrice,
              quantity,
              amount
            FROM sale_items
            WHERE sale_id = ?
            ORDER BY id ASC
          `,
          sale.id,
        );

        return {
          ...sale,
          items,
        };
      }),
    );

    response.json({
      scope,
      period,
      cashierNumber,
      sales: salesWithItems,
    });
  });

  app.delete("/api/sales", async (request: Request, response: Response) => {
    if (!(await requireAdmin(request, response, db))) {
      return;
    }

    await db.exec("BEGIN");
    try {
      await db.run("DELETE FROM sale_items");
      await db.run("DELETE FROM sales");
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    response.status(204).end();
  });

  app.delete("/api/sales/today", async (request: Request, response: Response) => {
    if (!(await requireAdmin(request, response, db))) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    await db.exec("BEGIN");
    try {
      await db.run(
        `
          DELETE FROM sale_items
          WHERE sale_id IN (
            SELECT id
            FROM sales
            WHERE date(sale_timestamp / 1000, 'unixepoch', 'localtime') = ?
          )
        `,
        today,
      );

      await db.run(
        `
          DELETE FROM sales
          WHERE date(sale_timestamp / 1000, 'unixepoch', 'localtime') = ?
        `,
        today,
      );

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    response.status(204).end();
  });

  if (existsSync(frontendIndexPath)) {
    app.use(express.static(frontendDistDir));

    app.get(/^\/(?!api(?:\/|$)).*/, (_request: Request, response: Response) => {
      response.sendFile(frontendIndexPath);
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: () => void) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error." });
  });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  app.listen(port, () => {
    console.log(`Bilbingo backend listening on http://localhost:${port}`);
    if (existsSync(frontendIndexPath)) {
      console.log(`Bilbingo frontend served from ${frontendDistDir}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});