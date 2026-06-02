import "./style.css";
import * as QRCode from "qrcode";

declare global {
  interface Window {
    __THIN_CLIENT_BOOTED?: boolean;
  }
}

window.__THIN_CLIENT_BOOTED = true;
document.getElementById("startup-error")?.setAttribute("hidden", "");

type ItemId = "storbingo" | "rovaren" | "freeplay" | "fiftyfifty";
type StatsScope = "week" | "season" | "all";
type AdminCashierFilter = "all" | "1" | "2" | "3";

type ShopItem = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
};

type SalesItem = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
  amount: number;
};

type SalesLogEntry = {
  id: string;
  timestamp: number;
  salespersonName: string;
  cashierNumber: number;
  seasonYear: number;
  seasonWeek: number;
  items: SalesItem[];
  totalItems: number;
  totalPrice: number;
};

type SalesSession = {
  role: "cashier" | "admin";
  salespersonName: string;
  cashierNumber?: number;
  seasonYear: number;
  seasonWeek: number;
  startedAt: number;
  authToken?: string;
};

type PendingSale = {
  queuedAt: number;
  entry: SalesLogEntry;
};

type ProductTotals = Record<ItemId, { qty: number; amount: number }>;

type CashierStatsResponse = {
  period: { seasonYear: number; seasonWeek: number };
  cashierNumber: number;
  totalCustomers: number;
  totalRevenue: number;
  products: Array<{ id: string; name: string; quantity: number; amount: number }>;
};

type AdminLoginResponse = {
  token: string;
  currentPeriod: { seasonYear: number; seasonWeek: number };
  expiresInMs: number;
};

type SalesLogResponse = {
  sales: Array<{
    id: string;
    salespersonName: string;
    cashierNumber: number;
    seasonYear: number;
    seasonWeek: number;
    totalItems: number;
    totalPrice: number;
    saleTimestamp: number;
    items: Array<{
      id: string;
      name: string;
      unitPrice: number;
      quantity: number;
      amount: number;
    }>;
  }>;
};

type ConnectInfoResponse = {
  hostName: string;
  urls: string[];
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const items: ShopItem[] = [
  { id: "storbingo", name: "Storbingo", price: 50, quantity: 0 },
  { id: "rovaren", name: "Rovaren", price: 20, quantity: 0 },
  { id: "freeplay", name: "Freeplay", price: 20, quantity: 0 },
  { id: "fiftyfifty", name: "FiftyFifty", price: 20, quantity: 0 },
];

const STORAGE_KEY = "bilbingo-sales-log";
const SESSION_KEY = "bilbingo-active-session";
const OUTBOX_KEY = "bilbingo-sales-outbox";
const SERVER_SALES_CACHE_KEY = "bilbingo-server-sales-cache";
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8787/api`;
const CLIENT_SYNC_INTERVAL_MS = 5000;

const shopListEl = document.querySelector<HTMLElement>("#shop-list");
const totalItemsEl = document.querySelector<HTMLElement>("#total-items");
const totalPriceEl = document.querySelector<HTMLElement>("#total-price");
const registerSaleBtn = document.querySelector<HTMLButtonElement>("#reset-btn");
const addAllButtonEl = document.querySelector<HTMLButtonElement>(".addall-btn");

const viewShopBtn = document.getElementById("view-shop-btn");
const viewStatsBtn = document.getElementById("view-stats-btn");
const viewConnectBtn = document.getElementById("view-connect-btn");
const viewAdminStatsBtn = document.getElementById("view-admin-stats-btn");
const viewLogsBtn = document.getElementById("view-logs-btn");
const cogBtn = document.getElementById("cog-btn");
const modeButtons = document.getElementById("mode-buttons");

const statsPage = document.getElementById("stats-page");
const connectPage = document.getElementById("connect-page");
const adminStatsPage = document.getElementById("admin-stats-page");
const logsPage = document.getElementById("logs-page");
const shopSection = document.getElementById("shop-section");

const statsContextEl = document.getElementById("stats-context");
const totalCustomersEl = document.getElementById("total-customers");
const productTotalsEl = document.getElementById("product-totals");
const totalRevenueEl = document.getElementById("total-revenue");

const adminScopeSelect = document.querySelector<HTMLSelectElement>("#admin-scope-select");
const adminTotalCustomersEl = document.getElementById("admin-total-customers");
const adminProductTotalsEl = document.getElementById("admin-product-totals");
const adminTotalRevenueEl = document.getElementById("admin-total-revenue");
const adminCashierBreakdownEl = document.getElementById("admin-cashier-breakdown");
const logsTitleEl = document.getElementById("logs-title");

const logsListEl = document.getElementById("logs-list");
const clearLogBtn = document.getElementById("clear-log-btn") as HTMLButtonElement | null;
const cancelSaleBtn = document.getElementById("cancel-sale-btn");

const startupScreen = document.getElementById("startup-screen");
const appContent = document.getElementById("app-content");
const startupForm = document.querySelector<HTMLFormElement>("#startup-form");
const startupAdminBtn = document.querySelector<HTMLButtonElement>("#startup-admin-btn");
const startupAdminPanel = document.getElementById("startup-admin-panel");
const startupAdminPinInput = document.querySelector<HTMLInputElement>("#startup-admin-pin");
const startupAdminLoginBtn = document.querySelector<HTMLButtonElement>("#startup-admin-login-btn");
const currentSeasonWeekEl = document.getElementById("current-season-week");
const activeSessionLabel = document.getElementById("active-session-label");
const syncStatusEl = document.getElementById("sync-status");
const connectStatusEl = document.getElementById("connect-status");
const connectPrimaryUrlEl = document.getElementById("connect-primary-url") as HTMLAnchorElement | null;
const connectAltUrlsEl = document.getElementById("connect-alt-urls");
const connectQrCanvasEl = document.getElementById("connect-qr") as HTMLCanvasElement | null;
const refreshConnectBtn = document.getElementById("refresh-connect-btn") as HTMLButtonElement | null;
const saleToastEl = document.getElementById("sale-toast");
const changeSessionBtn = document.getElementById("change-session-btn");
const shopIntroTextEl = document.getElementById("shop-intro-text");

let activeSession: SalesSession | null = null;
let activeLogDetailId: string | null = null;
let isSyncInFlight = false;
let isAdminRefreshInFlight = false;
let backendReachable = true;
let adminCashierFilter: AdminCashierFilter = "all";
let saleToastTimerId: number | null = null;
let isConnectViewLoading = false;
let lastRegisterSaleActionAt = 0;

if (!shopListEl || !totalItemsEl || !totalPriceEl || !registerSaleBtn) {
  throw new Error("Expected shop elements are missing from the page.");
}

const totalItemsValueEl = totalItemsEl;
const totalPriceValueEl = totalPriceEl;

function isItemId(value: string): value is ItemId {
  return value === "storbingo" || value === "rovaren" || value === "freeplay" || value === "fiftyfifty";
}

function setAdminCashierFilter(nextFilter: AdminCashierFilter, refresh = true): void {
  adminCashierFilter = nextFilter;

  if (refresh) {
    void refreshAdminData();
  }
}

function createEmptyProductTotals(): ProductTotals {
  return {
    storbingo: { qty: 0, amount: 0 },
    rovaren: { qty: 0, amount: 0 },
    freeplay: { qty: 0, amount: 0 },
    fiftyfifty: { qty: 0, amount: 0 },
  };
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`Failed to load ${key}`, error);
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key}`, error);
  }
}

function getIsoWeekPeriod(date: Date): { seasonYear: number; seasonWeek: number } {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);

  const seasonYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(seasonYear, 0, 1));
  const seasonWeek = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return { seasonYear, seasonWeek };
}

function getCurrentSeasonWeek(): { seasonYear: number; seasonWeek: number } {
  return getIsoWeekPeriod(new Date());
}

function createClientId(): string {
  const cryptoWithRandomUuid = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (cryptoWithRandomUuid?.randomUUID) {
    return cryptoWithRandomUuid.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now()}-${randomPart}`;
}

function normalizeSalesLogEntry(entry: Partial<SalesLogEntry>): SalesLogEntry {
  const timestamp = entry.timestamp ?? Date.now();
  const normalizedItems: SalesItem[] = Array.isArray(entry.items)
    ? entry.items
        .filter(
          (item): item is SalesItem =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof item.id === "string" &&
                isItemId(item.id) &&
                typeof item.name === "string" &&
                typeof item.price === "number" &&
                typeof item.quantity === "number" &&
                typeof item.amount === "number",
            ),
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          amount: item.amount,
        }))
    : [];

  return {
    id: entry.id ?? createClientId(),
    timestamp,
    salespersonName: entry.salespersonName ?? "Okand saljare",
    cashierNumber: entry.cashierNumber ?? 0,
    seasonYear: entry.seasonYear ?? new Date(timestamp).getFullYear(),
    seasonWeek: entry.seasonWeek ?? 0,
    items: normalizedItems,
    totalItems: entry.totalItems ?? normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
    totalPrice: entry.totalPrice ?? normalizedItems.reduce((sum, item) => sum + item.amount, 0),
  };
}

function loadActiveSession(): SalesSession | null {
  const parsed = loadJson<Partial<SalesSession> | null>(SESSION_KEY, null);
  if (!parsed || !parsed.salespersonName || !parsed.seasonYear || !parsed.seasonWeek) {
    return null;
  }

  if (parsed.role === "admin") {
    if (!parsed.authToken) {
      return null;
    }

    return {
      role: "admin",
      salespersonName: parsed.salespersonName,
      seasonYear: parsed.seasonYear,
      seasonWeek: parsed.seasonWeek,
      startedAt: parsed.startedAt ?? Date.now(),
      authToken: parsed.authToken,
    };
  }

  if (!parsed.cashierNumber) {
    return null;
  }

  return {
    role: "cashier",
    salespersonName: parsed.salespersonName,
    cashierNumber: parsed.cashierNumber,
    seasonYear: parsed.seasonYear,
    seasonWeek: parsed.seasonWeek,
    startedAt: parsed.startedAt ?? Date.now(),
  };
}

function saveActiveSession(session: SalesSession | null): void {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  saveJson(SESSION_KEY, session);
}

function loadSalesLog(): SalesLogEntry[] {
  return loadJson<Array<Partial<SalesLogEntry>>>(STORAGE_KEY, []).map(normalizeSalesLogEntry);
}

function saveSalesLog(logs: SalesLogEntry[]): void {
  saveJson(STORAGE_KEY, logs);
}

function appendSalesLogEntry(entry: SalesLogEntry): void {
  const logs = loadSalesLog();
  if (logs.some((current) => current.id === entry.id)) {
    return;
  }

  logs.push(entry);
  saveSalesLog(logs);
}

function loadPendingSales(): PendingSale[] {
  return loadJson<Array<{ queuedAt?: number; entry?: Partial<SalesLogEntry> }>>(OUTBOX_KEY, [])
    .filter((item): item is { queuedAt?: number; entry: Partial<SalesLogEntry> } => Boolean(item?.entry))
    .map((item) => ({
      queuedAt: item.queuedAt ?? Date.now(),
      entry: normalizeSalesLogEntry(item.entry),
    }));
}

function savePendingSales(pendingSales: PendingSale[]): void {
  saveJson(OUTBOX_KEY, pendingSales);
}

function loadServerSalesCache(): SalesLogEntry[] {
  return loadJson<Array<Partial<SalesLogEntry>>>(SERVER_SALES_CACHE_KEY, []).map(normalizeSalesLogEntry);
}

function saveServerSalesCache(logs: SalesLogEntry[]): void {
  saveJson(SERVER_SALES_CACHE_KEY, logs);
}

function removeAllLocalSalesData(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(OUTBOX_KEY);
  localStorage.removeItem(SERVER_SALES_CACHE_KEY);
}

function getPendingEntries(): SalesLogEntry[] {
  return loadPendingSales().map((item) => item.entry);
}

async function apiRequest<T>(path: string, init?: RequestInit, authToken?: string): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (authToken) {
    headers.set("authorization", `Bearer ${authToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
    backendReachable = true;
  } catch (error) {
    backendReachable = false;
    renderSyncStatus();
    throw error;
  }

  let data: unknown = undefined;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : response.statusText,
    );
  }

  renderSyncStatus();
  return data as T;
}

function findItem(id: ItemId): ShopItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Unknown item id: ${id}`);
  }
  return item;
}

function aggregateLogs(logs: SalesLogEntry[]): { totalCustomers: number; totalRevenue: number; products: ProductTotals } {
  const products = createEmptyProductTotals();
  let totalRevenue = 0;

  logs.forEach((entry) => {
    totalRevenue += entry.totalPrice;
    entry.items.forEach((item) => {
      products[item.id].qty += item.quantity;
      products[item.id].amount += item.amount;
    });
  });

  return {
    totalCustomers: logs.length,
    totalRevenue,
    products,
  };
}

function mergeProductTotals(base: ProductTotals, extra: ProductTotals): ProductTotals {
  const merged = createEmptyProductTotals();
  for (const id of Object.keys(merged) as ItemId[]) {
    merged[id].qty = base[id].qty + extra[id].qty;
    merged[id].amount = base[id].amount + extra[id].amount;
  }
  return merged;
}

function mergeStats(
  base: { totalCustomers: number; totalRevenue: number; products: ProductTotals },
  extra: { totalCustomers: number; totalRevenue: number; products: ProductTotals },
): { totalCustomers: number; totalRevenue: number; products: ProductTotals } {
  return {
    totalCustomers: base.totalCustomers + extra.totalCustomers,
    totalRevenue: base.totalRevenue + extra.totalRevenue,
    products: mergeProductTotals(base.products, extra.products),
  };
}

function responseProductsToTotals(products: CashierStatsResponse["products"]): ProductTotals {
  const totals = createEmptyProductTotals();
  products.forEach((product) => {
    if (!isItemId(product.id)) {
      return;
    }
    totals[product.id].qty += Number(product.quantity) || 0;
    totals[product.id].amount += Number(product.amount) || 0;
  });
  return totals;
}

function mergeLogs(...sets: SalesLogEntry[][]): SalesLogEntry[] {
  const byId = new Map<string, SalesLogEntry>();
  sets.flat().forEach((entry) => {
    byId.set(entry.id, entry);
  });
  return Array.from(byId.values()).sort((left, right) => left.timestamp - right.timestamp);
}

function matchesCurrentWeekAndCashier(entry: SalesLogEntry, session: SalesSession): boolean {
  return (
    session.role === "cashier" &&
    Boolean(session.cashierNumber) &&
    entry.seasonYear === session.seasonYear &&
    entry.seasonWeek === session.seasonWeek &&
    entry.cashierNumber === session.cashierNumber
  );
}

function filterLogsForAdmin(
  logs: SalesLogEntry[],
  seasonYear: number,
  seasonWeek: number,
  scope: StatsScope,
  cashierFilter: AdminCashierFilter,
): SalesLogEntry[] {
  return logs.filter((entry) => {
    if (scope === "week" && (entry.seasonYear !== seasonYear || entry.seasonWeek !== seasonWeek)) {
      return false;
    }
    if (scope === "season" && entry.seasonYear !== seasonYear) {
      return false;
    }
    if (cashierFilter !== "all" && entry.cashierNumber !== Number(cashierFilter)) {
      return false;
    }
    return true;
  });
}

function mapServerLogs(response: SalesLogResponse): SalesLogEntry[] {
  return response.sales.map((sale) => ({
    id: sale.id,
    timestamp: sale.saleTimestamp,
    salespersonName: sale.salespersonName,
    cashierNumber: sale.cashierNumber,
    seasonYear: sale.seasonYear,
    seasonWeek: sale.seasonWeek,
    items: sale.items
      .filter((item) => isItemId(item.id))
      .map((item) => ({
        id: item.id as ItemId,
        name: item.name,
        price: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
      })),
    totalItems: sale.totalItems,
    totalPrice: sale.totalPrice,
  }));
}

function buildSalePayload(entry: SalesLogEntry): {
  id: string;
  salespersonName: string;
  cashierNumber: number;
  saleTimestamp: number;
  items: Array<{ id: ItemId; name: string; price: number; quantity: number }>;
} {
  return {
    id: entry.id,
    salespersonName: entry.salespersonName,
    cashierNumber: entry.cashierNumber,
    saleTimestamp: entry.timestamp,
    items: entry.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    })),
  };
}

function buildSaleEntryFromCurrent(): SalesLogEntry | null {
  if (!activeSession || activeSession.role !== "cashier" || !activeSession.cashierNumber) {
    return null;
  }

  const itemsSnapshot: SalesItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    amount: item.quantity * item.price,
  }));

  const totalItems = itemsSnapshot.reduce((sum, item) => sum + item.quantity, 0);
  if (totalItems === 0) {
    return null;
  }

  const totalPrice = itemsSnapshot.reduce((sum, item) => sum + item.amount, 0);
  return {
    id: createClientId(),
    timestamp: Date.now(),
    salespersonName: activeSession.salespersonName,
    cashierNumber: activeSession.cashierNumber,
    seasonYear: activeSession.seasonYear,
    seasonWeek: activeSession.seasonWeek,
    items: itemsSnapshot,
    totalItems,
    totalPrice,
  };
}

function queueSaleForSync(entry: SalesLogEntry): void {
  const pendingSales = loadPendingSales();
  if (pendingSales.some((item) => item.entry.id === entry.id)) {
    return;
  }
  pendingSales.push({ queuedAt: Date.now(), entry });
  savePendingSales(pendingSales);
  renderSyncStatus();
}

async function syncPendingSales(): Promise<void> {
  if (isSyncInFlight) {
    return;
  }

  const pendingSales = loadPendingSales();
  if (pendingSales.length === 0) {
    renderSyncStatus();
    return;
  }

  isSyncInFlight = true;
  renderSyncStatus();

  try {
    let remaining = pendingSales;
    let syncedAny = false;

    for (const pendingSale of pendingSales) {
      try {
        await apiRequest("/sales", {
          method: "POST",
          body: JSON.stringify(buildSalePayload(pendingSale.entry)),
        });
        remaining = remaining.filter((item) => item.entry.id !== pendingSale.entry.id);
        savePendingSales(remaining);
        syncedAny = true;
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          remaining = remaining.filter((item) => item.entry.id !== pendingSale.entry.id);
          savePendingSales(remaining);
          continue;
        }
        break;
      }
    }

    if (syncedAny) {
      if (activeSession?.role === "cashier") {
        await renderStats();
      }
      if (activeSession?.role === "admin") {
        await refreshAdminData();
      }
    }
  } finally {
    isSyncInFlight = false;
    renderSyncStatus();
  }
}

function clearSummaryValues(): void {
  if (statsContextEl) statsContextEl.textContent = "Ingen aktiv session.";
  if (totalCustomersEl) totalCustomersEl.textContent = "0";
  if (productTotalsEl) productTotalsEl.innerHTML = "";
  if (totalRevenueEl) totalRevenueEl.textContent = "0 kr";
}

function renderStatsValues(
  contextText: string,
  stats: { totalCustomers: number; totalRevenue: number; products: ProductTotals },
): void {
  if (statsContextEl) {
    statsContextEl.textContent = contextText;
  }
  if (totalCustomersEl) {
    totalCustomersEl.textContent = String(stats.totalCustomers);
  }
  if (productTotalsEl) {
    productTotalsEl.innerHTML = "";
    for (const id of Object.keys(stats.products) as ItemId[]) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${findItem(id).name}</span><strong>${stats.products[id].qty} st - ${stats.products[id].amount} kr</strong>`;
      productTotalsEl.appendChild(row);
    }
  }
  if (totalRevenueEl) {
    totalRevenueEl.textContent = `${stats.totalRevenue} kr`;
  }
}

async function renderStats(): Promise<void> {
  if (!activeSession || activeSession.role !== "cashier" || !activeSession.cashierNumber) {
    clearSummaryValues();
    return;
  }

  const session = activeSession;
  const pendingStats = aggregateLogs(getPendingEntries().filter((entry) => matchesCurrentWeekAndCashier(entry, session)));
  const baseContext = `Din statistik for säsong ${session.seasonYear} vecka ${session.seasonWeek}, kassa ${session.cashierNumber}.`;

  try {
    const response = await apiRequest<CashierStatsResponse>(`/stats/cashier/current?cashierNumber=${session.cashierNumber}`);
    if (activeSession !== session) {
      return;
    }
    const remoteStats = {
      totalCustomers: response.totalCustomers,
      totalRevenue: response.totalRevenue,
      products: responseProductsToTotals(response.products),
    };
    const merged = mergeStats(remoteStats, pendingStats);
    const contextText = pendingStats.totalCustomers > 0
      ? `${baseContext} ${pendingStats.totalCustomers} osynkade kop visas ocksa.`
      : baseContext;
    renderStatsValues(contextText, merged);
  } catch {
    if (activeSession !== session) {
      return;
    }
    const fallbackStats = aggregateLogs(loadSalesLog().filter((entry) => matchesCurrentWeekAndCashier(entry, session)));
    renderStatsValues(`${baseContext} Offline-lage: lokal statistik visas.`, fallbackStats);
  }
}

function clearAdminViews(): void {
  if (adminTotalCustomersEl) adminTotalCustomersEl.textContent = "0";
  if (adminProductTotalsEl) adminProductTotalsEl.innerHTML = "";
  if (adminTotalRevenueEl) adminTotalRevenueEl.textContent = "0 kr";
  if (adminCashierBreakdownEl) adminCashierBreakdownEl.innerHTML = "";
  if (logsTitleEl) logsTitleEl.textContent = "Säljlogg - Alla kassor";
  if (logsListEl) logsListEl.innerHTML = "";
}

function renderLogsTitle(): void {
  if (!logsTitleEl) {
    return;
  }

  logsTitleEl.textContent = adminCashierFilter === "all"
    ? "Säljlogg - Alla kassor"
    : `Säljlogg - Kassa ${adminCashierFilter}`;
}

function renderAdminStatsFromEntries(logs: SalesLogEntry[], breakdownLogs: SalesLogEntry[]): void {
  const stats = aggregateLogs(logs);
  if (adminTotalCustomersEl) adminTotalCustomersEl.textContent = String(stats.totalCustomers);
  if (adminTotalRevenueEl) adminTotalRevenueEl.textContent = `${stats.totalRevenue} kr`;

  if (adminProductTotalsEl) {
    adminProductTotalsEl.innerHTML = "";
    for (const id of Object.keys(stats.products) as ItemId[]) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${findItem(id).name}</span><strong>${stats.products[id].qty} st - ${stats.products[id].amount} kr</strong>`;
      adminProductTotalsEl.appendChild(row);
    }
  }

  if (adminCashierBreakdownEl) {
    adminCashierBreakdownEl.innerHTML = "";
    const byCashier = new Map<number, { customers: number; revenue: number }>();
    breakdownLogs.forEach((entry) => {
      const current = byCashier.get(entry.cashierNumber) ?? { customers: 0, revenue: 0 };
      current.customers += 1;
      current.revenue += entry.totalPrice;
      byCashier.set(entry.cashierNumber, current);
    });

    const allCashierStats = aggregateLogs(breakdownLogs);
    const allRow = document.createElement("div");
    allRow.className = "cashier-row";
    allRow.setAttribute("role", "button");
    allRow.tabIndex = 0;
    allRow.setAttribute("aria-label", "Visa statistik for alla kassor");
    const isAllActive = adminCashierFilter === "all";
    if (isAllActive) {
      allRow.classList.add("is-active");
    }
    allRow.innerHTML = `
      <div class="cashier-row-head">
        <strong>Alla kassor</strong>
        ${isAllActive ? "<span class=\"cashier-selected-badge\">Vald</span>" : ""}
      </div>
      <div>${allCashierStats.totalCustomers} kunder - ${allCashierStats.totalRevenue} kr</div>
    `;
    allRow.addEventListener("click", () => {
      setAdminCashierFilter("all");
    });
    allRow.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      setAdminCashierFilter("all");
    });
    adminCashierBreakdownEl.appendChild(allRow);

    [1, 2, 3].forEach((cashierNumber) => {
      const current = byCashier.get(cashierNumber) ?? { customers: 0, revenue: 0 };
      const row = document.createElement("div");
      row.className = "cashier-row";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Visa statistik for kassa ${cashierNumber}`);
      const isCashierActive = adminCashierFilter === String(cashierNumber);
      if (isCashierActive) {
        row.classList.add("is-active");
      }
      row.innerHTML = `
        <div class="cashier-row-head">
          <strong>Kassa ${cashierNumber}</strong>
          ${isCashierActive ? "<span class=\"cashier-selected-badge\">Vald</span>" : ""}
        </div>
        <div>${current.customers} kunder - ${current.revenue} kr</div>
      `;
      row.addEventListener("click", () => {
        setAdminCashierFilter(String(cashierNumber) as AdminCashierFilter);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        setAdminCashierFilter(String(cashierNumber) as AdminCashierFilter);
      });
      adminCashierBreakdownEl.appendChild(row);
    });
  }
}

function renderLogsFromEntries(logs: SalesLogEntry[]): void {
  if (!logsListEl) {
    return;
  }

  renderLogsTitle();
  logsListEl.innerHTML = "";
  logs
    .slice()
    .sort((left, right) => right.timestamp - left.timestamp)
    .forEach((entry) => {
      const div = document.createElement("div");
      div.className = "log-entry";
      const date = new Date(entry.timestamp).toLocaleString();
      div.innerHTML = `
        <div class="log-summary">
          <div>
            <strong>${date}</strong>
            <div>${entry.salespersonName} - Säsong ${entry.seasonYear} vecka ${entry.seasonWeek} - Kassa ${entry.cashierNumber}</div>
            <div>${entry.totalItems} varor - ${entry.totalPrice} kr</div>
          </div>
          <button class="details-toggle-btn" type="button">Visa</button>
        </div>
      `;

      if (entry.id === activeLogDetailId) {
        const details = document.createElement("div");
        details.className = "log-detail";
        details.innerHTML = `
          <div>
            <ul>
              ${entry.items.map((item) => `<li>${item.name}: ${item.quantity} st - ${item.amount} kr</li>`).join("")}
            </ul>
          </div>
        `;
        div.appendChild(details);
      }

      div.querySelector("button")?.addEventListener("click", () => {
        activeLogDetailId = activeLogDetailId === entry.id ? null : entry.id;
        renderLogsFromEntries(logs);
      });

      logsListEl.appendChild(div);
    });
}

function handleAdminUnauthorized(): void {
  if (activeSession?.role !== "admin") {
    return;
  }

  window.alert("Adminsessionen har gatt ut. Logga in igen.");
  activeSession = null;
  saveActiveSession(null);
  clearAdminViews();
  syncSessionUI();
}

async function loadAdminLogs(session: SalesSession): Promise<SalesLogEntry[]> {
  if (session.role !== "admin" || !session.authToken) {
    return getPendingEntries();
  }

  try {
    const response = await apiRequest<SalesLogResponse>("/sales-log?scope=all&cashierNumber=all&limit=500", undefined, session.authToken);
    const serverLogs = mapServerLogs(response);
    saveServerSalesCache(serverLogs);
    return mergeLogs(serverLogs, getPendingEntries());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      handleAdminUnauthorized();
      return [];
    }
    return mergeLogs(loadServerSalesCache(), getPendingEntries());
  }
}

async function refreshAdminData(): Promise<void> {
  if (!activeSession || activeSession.role !== "admin") {
    clearAdminViews();
    return;
  }

  if (isAdminRefreshInFlight) {
    return;
  }

  isAdminRefreshInFlight = true;

  try {
    const session = activeSession;
    const allLogs = await loadAdminLogs(session);
    if (activeSession !== session) {
      return;
    }

    const scope = (adminScopeSelect?.value ?? "week") as StatsScope;
    const scopeLogs = filterLogsForAdmin(allLogs, session.seasonYear, session.seasonWeek, scope, "all");
    const visibleLogs = adminCashierFilter === "all"
      ? scopeLogs
      : scopeLogs.filter((entry) => entry.cashierNumber === Number(adminCashierFilter));
    renderAdminStatsFromEntries(visibleLogs, scopeLogs);
    renderLogsFromEntries(visibleLogs);
  } finally {
    isAdminRefreshInFlight = false;
  }
}

function renderSessionLabel(): void {
  if (!activeSessionLabel) {
    return;
  }
  if (!activeSession) {
    activeSessionLabel.textContent = "";
    return;
  }
  if (activeSession.role === "admin") {
    activeSessionLabel.textContent = `Admin - Säsong ${activeSession.seasonYear} vecka ${activeSession.seasonWeek}`;
    return;
  }
  activeSessionLabel.textContent = `Inloggad: ${activeSession.salespersonName} - Säsong ${activeSession.seasonYear} vecka ${activeSession.seasonWeek} - Kassa ${activeSession.cashierNumber}`;
}

function renderStartupPeriod(): void {
  if (!currentSeasonWeekEl) {
    return;
  }
  const current = getCurrentSeasonWeek();
  currentSeasonWeekEl.textContent = `${current.seasonYear} + vecka ${current.seasonWeek}`;
}

function renderSyncStatus(): void {
  if (!syncStatusEl) {
    return;
  }
  if (!activeSession || activeSession.role !== "cashier") {
    syncStatusEl.hidden = true;
    syncStatusEl.textContent = "";
    syncStatusEl.removeAttribute("data-sync-state");
    syncStatusEl.removeAttribute("title");
    syncStatusEl.removeAttribute("aria-label");
    return;
  }

  syncStatusEl.hidden = false;
  syncStatusEl.textContent = "";
  syncStatusEl.setAttribute("role", "status");
  syncStatusEl.setAttribute("aria-live", "polite");

  const unsyncedCount = loadPendingSales().length;
  let state: "ok" | "warn" | "error" = "ok";
  let label = "Synkad";

  if (isSyncInFlight) {
    state = "warn";
    label = `Synkroniserar ${unsyncedCount} osynkade forsaljningar...`;
  } else if (!backendReachable) {
    state = "error";
    label = unsyncedCount > 0
      ? `Servern kan inte nas. ${unsyncedCount} forsaljningar sparade lokalt.`
      : "Servern kan inte nas. Visar lokalt cachelagrad data.";
  } else if (unsyncedCount > 0) {
    state = "warn";
    label = `${unsyncedCount} forsaljningar vantar pa synk till servern.`;
  }

  syncStatusEl.setAttribute("data-sync-state", state);
  syncStatusEl.setAttribute("title", label);
  syncStatusEl.setAttribute("aria-label", label);
}

function getDefaultConnectUrl(): string {
  return window.location.href;
}

function setConnectStatus(message: string): void {
  if (connectStatusEl) {
    connectStatusEl.textContent = message;
  }
}

function updateConnectLinks(urls: string[], hostName: string): string {
  const fallbackUrl = getDefaultConnectUrl();
  const cleanedUrls = urls
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const preferredUrl = cleanedUrls.find((entry) => !entry.includes("localhost") && !entry.includes("127.0.0.1"))
    ?? cleanedUrls[0]
    ?? fallbackUrl;

  if (connectPrimaryUrlEl) {
    connectPrimaryUrlEl.href = preferredUrl;
    connectPrimaryUrlEl.textContent = preferredUrl;
  }

  if (connectAltUrlsEl) {
    connectAltUrlsEl.innerHTML = "";

    cleanedUrls
      .filter((entry) => entry !== preferredUrl)
      .forEach((entry) => {
        const link = document.createElement("a");
        link.className = "connect-alt-url";
        link.href = entry;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = entry;
        connectAltUrlsEl.appendChild(link);
      });
  }

  setConnectStatus(`Server: ${hostName}. Skanna QR-koden eller öppna länken manuellt.`);
  return preferredUrl;
}

async function fetchConnectInfo(): Promise<ConnectInfoResponse> {
  const protocol = window.location.protocol.replace(":", "") || "http";
  const defaultPort = protocol === "https" ? "443" : "80";
  const port = window.location.port || defaultPort;
  const path = window.location.pathname || "/";
  const query = new URLSearchParams({ protocol, port, path });
  const response = await apiRequest<ConnectInfoResponse>(`/server/connect-info?${query.toString()}`);
  return response;
}

async function renderConnectPage(force = false): Promise<void> {
  if (!connectQrCanvasEl || isConnectViewLoading) {
    return;
  }

  if (!force && connectPage?.hidden !== false) {
    return;
  }

  isConnectViewLoading = true;
  setConnectStatus("Laddar anslutningslankar...");

  try {
    const response = await fetchConnectInfo();
    const selectedUrl = updateConnectLinks(response.urls, response.hostName);

    await QRCode.toCanvas(connectQrCanvasEl, selectedUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#195637",
        light: "#0000",
      },
    });
  } catch {
    const fallbackUrl = getDefaultConnectUrl();
    updateConnectLinks([fallbackUrl], "lokal klient");
    setConnectStatus("Kunde inte hämta serveradresser. Visar aktuell klientlänk.");
    await QRCode.toCanvas(connectQrCanvasEl, fallbackUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#195637",
        light: "#0000",
      },
    });
  } finally {
    isConnectViewLoading = false;
  }
}

function showSaleToast(totalPrice: number): void {
  if (!saleToastEl) {
    return;
  }

  saleToastEl.textContent = `Köp registrerat - ${totalPrice} kr`;
  saleToastEl.hidden = false;
  saleToastEl.classList.remove("is-visible");

  // Force reflow so the animation can be replayed for rapid consecutive purchases.
  void saleToastEl.offsetWidth;
  saleToastEl.classList.add("is-visible");

  if (saleToastTimerId !== null) {
    window.clearTimeout(saleToastTimerId);
  }

  saleToastTimerId = window.setTimeout(() => {
    saleToastEl.classList.remove("is-visible");
    saleToastEl.hidden = true;
    saleToastTimerId = null;
  }, 2000);
}

function syncRoleAccessUI(): void {
  const isAdmin = activeSession?.role === "admin";
  if (viewShopBtn) viewShopBtn.hidden = isAdmin;
  if (viewStatsBtn) viewStatsBtn.hidden = isAdmin;
  if (viewConnectBtn) viewConnectBtn.hidden = !isAdmin;
  if (viewAdminStatsBtn) viewAdminStatsBtn.hidden = !isAdmin;
  if (viewLogsBtn) viewLogsBtn.hidden = !isAdmin;
  if (clearLogBtn) clearLogBtn.hidden = !isAdmin;
  if (shopSection) shopSection.hidden = isAdmin;
  if (shopIntroTextEl) shopIntroTextEl.hidden = isAdmin;
  if (syncStatusEl) syncStatusEl.hidden = isAdmin;
}

function syncSessionUI(): void {
  const hasSession = Boolean(activeSession);
  if (startupScreen) startupScreen.hidden = hasSession;
  if (appContent) appContent.hidden = !hasSession;
  renderSessionLabel();
  syncRoleAccessUI();
  renderSyncStatus();
}

function showView(view: "shop" | "stats" | "connect" | "admin" | "logs"): void {
  if (shopSection) {
    shopSection.hidden = view !== "shop" || activeSession?.role === "admin";
  }
  if (statsPage) statsPage.hidden = view !== "stats";
  if (connectPage) connectPage.hidden = view !== "connect";
  if (adminStatsPage) adminStatsPage.hidden = view !== "admin";
  if (logsPage) logsPage.hidden = view !== "logs";
}

async function loginAsAdminWithPin(pinRaw: string): Promise<void> {
  const pin = pinRaw.trim();
  if (!pin) {
    window.alert("Ange admin-PIN.");
    return;
  }

  try {
    const response = await apiRequest<AdminLoginResponse>("/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });

    activeSession = {
      role: "admin",
      salespersonName: "Admin",
      seasonYear: response.currentPeriod.seasonYear,
      seasonWeek: response.currentPeriod.seasonWeek,
      startedAt: Date.now(),
      authToken: response.token,
    };
    saveActiveSession(activeSession);
    if (startupAdminPanel) startupAdminPanel.hidden = true;
    if (startupAdminPinInput) startupAdminPinInput.value = "";
    resetCurrentSale();
    syncSessionUI();
    showView("admin");
    await refreshAdminData();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      window.alert("Fel admin-PIN.");
      return;
    }
    window.alert("Kunde inte logga in admin mot servern.");
  }
}

async function logoutCurrentSession(): Promise<void> {
  const previousSession = activeSession;
  activeSession = null;
  saveActiveSession(null);
  syncSessionUI();
  showView("shop");

  if (previousSession?.role === "admin" && previousSession.authToken) {
    try {
      await apiRequest<void>("/auth/admin/logout", { method: "POST" }, previousSession.authToken);
    } catch {
      // Ignore logout errors when leaving the session.
    }
  }
}

function resetCurrentSale(): void {
  items.forEach((item) => {
    item.quantity = 0;
  });
  render();
}

function render(): void {
  items.forEach((item) => {
    const qtyEl = document.querySelector<HTMLElement>(`#qty-${item.id}`);
    if (qtyEl) {
      qtyEl.textContent = String(item.quantity);
    }
  });

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  totalItemsValueEl.textContent = String(totalItems);
  totalPriceValueEl.textContent = `${totalPrice} kr`;
}

startupAdminBtn?.addEventListener("click", () => {
  if (startupAdminPanel) {
    startupAdminPanel.hidden = !startupAdminPanel.hidden;
  }
  startupAdminPinInput?.focus();
});

startupAdminLoginBtn?.addEventListener("click", () => {
  void loginAsAdminWithPin(startupAdminPinInput?.value ?? "");
});

startupAdminPinInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loginAsAdminWithPin(startupAdminPinInput.value);
  }
});

startupForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(startupForm);
  const salespersonName = String(formData.get("salespersonName") ?? "").trim();
  const cashierNumber = Number(formData.get("cashierNumber") ?? "0");

  if (!salespersonName) {
    window.alert("Fyll i namn for att starta passet.");
    return;
  }
  if (!Number.isFinite(cashierNumber) || cashierNumber < 1 || cashierNumber > 3) {
    window.alert("Valj kassanummer for kassorspass.");
    return;
  }

  const current = getCurrentSeasonWeek();
  activeSession = {
    role: "cashier",
    salespersonName,
    cashierNumber,
    seasonYear: current.seasonYear,
    seasonWeek: current.seasonWeek,
    startedAt: Date.now(),
  };
  saveActiveSession(activeSession);
  if (startupAdminPanel) startupAdminPanel.hidden = true;
  resetCurrentSale();
  syncSessionUI();
  showView("shop");
  void syncPendingSales();
  void renderStats();
});

changeSessionBtn?.addEventListener("click", () => {
  if (!window.confirm("Byta pass? Aktuell kundkorg nollstalls.")) {
    return;
  }
  resetCurrentSale();
  if (modeButtons) {
    modeButtons.hidden = true;
  }
  if (cogBtn) {
    cogBtn.setAttribute("aria-expanded", "false");
  }
  void logoutCurrentSession();
});

viewShopBtn?.addEventListener("click", () => {
  showView("shop");
  if (modeButtons) modeButtons.hidden = true;
  if (cogBtn) cogBtn.setAttribute("aria-expanded", "false");
});

viewStatsBtn?.addEventListener("click", () => {
  showView("stats");
  void renderStats();
  if (modeButtons) modeButtons.hidden = true;
  if (cogBtn) cogBtn.setAttribute("aria-expanded", "false");
});

viewConnectBtn?.addEventListener("click", () => {
  if (activeSession?.role !== "admin") {
    return;
  }
  showView("connect");
  void renderConnectPage(true);
  if (modeButtons) modeButtons.hidden = true;
  if (cogBtn) cogBtn.setAttribute("aria-expanded", "false");
});

viewAdminStatsBtn?.addEventListener("click", () => {
  if (activeSession?.role !== "admin") {
    return;
  }
  showView("admin");
  void refreshAdminData();
  if (modeButtons) modeButtons.hidden = true;
  if (cogBtn) cogBtn.setAttribute("aria-expanded", "false");
});

viewLogsBtn?.addEventListener("click", () => {
  if (activeSession?.role !== "admin") {
    return;
  }
  showView("logs");
  void refreshAdminData();
  if (modeButtons) modeButtons.hidden = true;
  if (cogBtn) cogBtn.setAttribute("aria-expanded", "false");
});

clearLogBtn?.addEventListener("click", async () => {
  if (activeSession?.role !== "admin" || !activeSession.authToken) {
    return;
  }
  if (!window.confirm("Ar du saker pa att du vill tomma loggen? Detta rensar bade servern och lokal cache.")) {
    return;
  }

  try {
    await apiRequest<void>("/sales", { method: "DELETE" }, activeSession.authToken);
    removeAllLocalSalesData();
    activeLogDetailId = null;
    resetCurrentSale();
    await refreshAdminData();
    void renderStats();
    showView("logs");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      handleAdminUnauthorized();
      return;
    }
    window.alert("Kunde inte tomma loggen fran servern.");
  }
});

cancelSaleBtn?.addEventListener("click", () => {
  resetCurrentSale();
});

cogBtn?.addEventListener("click", () => {
  if (!modeButtons) {
    return;
  }
  const isVisible = !modeButtons.hidden;
  if (isVisible) {
    modeButtons.hidden = true;
    cogBtn.setAttribute("aria-expanded", "false");
    showView(activeSession?.role === "admin" ? "admin" : "shop");
    return;
  }
  modeButtons.hidden = false;
  cogBtn.setAttribute("aria-expanded", "true");
});

shopListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[data-action][data-item-id]");
  if (!button) {
    return;
  }

  const itemId = button.dataset.itemId;
  const action = button.dataset.action;
  if (!itemId || !action || !isItemId(itemId)) {
    return;
  }

  const item = findItem(itemId);
  if (action === "increment") {
    item.quantity += 1;
  } else if (action === "decrement") {
    item.quantity = Math.max(0, item.quantity - 1);
  }
  render();
});

registerSaleBtn.addEventListener("click", () => {
  const now = Date.now();
  if (now - lastRegisterSaleActionAt < 300) {
    return;
  }
  lastRegisterSaleActionAt = now;

  if (!activeSession || activeSession.role !== "cashier" || !activeSession.cashierNumber) {
    window.alert("Starta ett kassapass på den här enheten innan du använder Nästa kund.");
    return;
  }

  const entry = buildSaleEntryFromCurrent();
  if (!entry) {
    return;
  }

  appendSalesLogEntry(entry);
  queueSaleForSync(entry);
  showSaleToast(entry.totalPrice);
  void syncPendingSales();

  resetCurrentSale();
  void renderStats();
});

registerSaleBtn.addEventListener("touchend", (event) => {
  event.preventDefault();
  registerSaleBtn.click();
}, { passive: false });

adminScopeSelect?.addEventListener("change", () => {
  void refreshAdminData();
});

refreshConnectBtn?.addEventListener("click", () => {
  void renderConnectPage(true);
});

addAllButtonEl?.addEventListener("click", () => {
  items.forEach((item) => {
    item.quantity += 1;
  });
  render();
});

window.addEventListener("online", () => {
  backendReachable = true;
  renderSyncStatus();
  void syncPendingSales();
  void renderStats();
  void refreshAdminData();
  void renderConnectPage(true);
});

window.addEventListener("offline", () => {
  backendReachable = false;
  renderSyncStatus();
});

window.setInterval(() => {
  void syncPendingSales();
  if (activeSession?.role === "admin") {
    void refreshAdminData();
  }
}, CLIENT_SYNC_INTERVAL_MS);

activeSession = loadActiveSession();
setAdminCashierFilter("all", false);
renderStartupPeriod();
syncSessionUI();
showView(activeSession?.role === "admin" ? "admin" : "shop");
render();
void syncPendingSales();
void renderStats();
void refreshAdminData();
