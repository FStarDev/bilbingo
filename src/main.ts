import "./style.css";

(window as any).__THIN_CLIENT_BOOTED = true;
document.getElementById("startup-error")?.setAttribute("hidden", "");

type ItemId = "bingohafte" | "freeplay" | "storbingo";
type Action = "increment" | "decrement";

type ShopItem = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
};

const items: ShopItem[] = [
  { id: "bingohafte", name: "Bingohafte", price: 50, quantity: 0 },
  { id: "freeplay", name: "Freeplay", price: 20, quantity: 0 },
  { id: "storbingo", name: "Storbingo", price: 20, quantity: 0 }
];

const shopList = document.querySelector<HTMLElement>("#shop-list");
const totalItemsEl = document.querySelector<HTMLElement>("#total-items");
const totalPriceEl = document.querySelector<HTMLElement>("#total-price");
const resetButton = document.querySelector<HTMLButtonElement>("#reset-btn");
const addAllButton = document.querySelector<HTMLButtonElement>(".addall-btn");

if (!shopList || !totalItemsEl || !totalPriceEl || !resetButton) {
  throw new Error("Expected shop elements are missing from the page.");
}

const shopListEl = shopList;
const totalItemsValueEl = totalItemsEl;
const totalPriceValueEl = totalPriceEl;
const resetButtonEl = resetButton;
const addAllButtonEl = addAllButton;

function findItem(id: ItemId): ShopItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Unknown item id: ${id}`);
  }
  return item;
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

shopListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[data-action][data-item-id]");
  if (!button) {
    return;
  }

  const itemId = button.dataset.itemId as ItemId | undefined;
  const action = button.dataset.action as Action | undefined;
  if (!itemId || !action) {
    return;
  }

  const item = findItem(itemId);
  if (action === "increment") {
    item.quantity += 1;
  } else {
    item.quantity = Math.max(0, item.quantity - 1);
  }

  render();
});

resetButtonEl.addEventListener("click", () => {
  items.forEach((item) => {
    item.quantity = 0;
  });
  render();
});

addAllButtonEl?.addEventListener("click", () => {
  items.forEach((item) => {
    item.quantity += 1;
  });
  render();
});

render();
