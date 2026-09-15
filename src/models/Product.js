import { prisma } from '../database/connection.js';
import { restaurant } from '../core/restaurant.js';

// Меню в памяти: категории с блюдами в порядке из menu.yaml
let categories = [];
let products = new Map();

function toProduct(row) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    oldPrice: row.oldPrice == null ? null : Number(row.oldPrice),
    weight: row.weight,
    photo: row.photo,
    photoFileId: row.photoFileId,
    spicy: row.spicy,
    badges: row.badges,
    inStock: row.inStock,
  };
}

// JSON с отсортированными ключами — чтобы сравнивать данные из базы и из файла
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function productData(item, categoryId, sortOrder) {
  return {
    categoryId,
    name: item.name,
    description: item.description,
    price: item.price,
    oldPrice: item.oldPrice,
    weight: item.weight,
    photo: item.photo,
    spicy: item.spicy,
    badges: item.badges,
    sortOrder,
    isActive: true,
  };
}

function sameProduct(row, data) {
  return (
    row.categoryId === data.categoryId &&
    stable(row.name) === stable(data.name) &&
    stable(row.description) === stable(data.description) &&
    Number(row.price) === data.price &&
    (row.oldPrice == null ? null : Number(row.oldPrice)) === data.oldPrice &&
    stable(row.weight) === stable(data.weight) &&
    row.photo === data.photo &&
    row.spicy === data.spicy &&
    stable(row.badges) === stable(data.badges) &&
    row.sortOrder === data.sortOrder &&
    row.isActive === data.isActive
  );
}

// Переносит меню из restaurant/menu.yaml в базу. Стоп-лист (inStock) не трогает
export async function syncMenu(menu = restaurant.menu) {
  const [dbCategories, dbProducts] = await Promise.all([prisma.category.findMany(), prisma.product.findMany()]);
  const categoryRows = new Map(dbCategories.map((row) => [row.id, row]));
  const productRows = new Map(dbProducts.map((row) => [row.id, row]));

  const operations = [];
  const newCategories = [];
  const newProducts = [];
  const productUpdates = [];

  menu.categories.forEach((category, index) => {
    const data = { name: category.name, sortOrder: index, isActive: category.items.length > 0 };
    const row = categoryRows.get(category.id);
    if (!row) newCategories.push({ id: category.id, ...data });
    else if (stable(row.name) !== stable(data.name) || row.sortOrder !== data.sortOrder || row.isActive !== data.isActive) {
      operations.push(prisma.category.update({ where: { id: category.id }, data }));
    }
  });

  for (const category of menu.categories) {
    category.items.forEach((item, index) => {
      const data = productData(item, category.id, index);
      const row = productRows.get(item.id);
      if (!row) newProducts.push({ id: item.id, ...data });
      else if (!sameProduct(row, data)) {
        const resetPhoto = row.photo !== data.photo ? { photoFileId: null } : {};
        productUpdates.push(prisma.product.update({ where: { id: item.id }, data: { ...data, ...resetPhoto } }));
      }
    });
  }

  const fileCategoryIds = new Set(menu.categories.map((category) => category.id));
  const fileProductIds = new Set(menu.categories.flatMap((category) => category.items.map((item) => item.id)));
  const hiddenCategories = dbCategories.filter((row) => row.isActive && !fileCategoryIds.has(row.id)).map((row) => row.id);
  const hiddenProducts = dbProducts.filter((row) => row.isActive && !fileProductIds.has(row.id)).map((row) => row.id);

  if (newCategories.length) operations.unshift(prisma.category.createMany({ data: newCategories }));
  if (newProducts.length) operations.push(prisma.product.createMany({ data: newProducts }));
  operations.push(...productUpdates);
  if (hiddenProducts.length) {
    operations.push(prisma.product.updateMany({ where: { id: { in: hiddenProducts } }, data: { isActive: false } }));
  }
  if (hiddenCategories.length) {
    operations.push(prisma.category.updateMany({ where: { id: { in: hiddenCategories } }, data: { isActive: false } }));
  }

  if (operations.length) await prisma.$transaction(operations, { timeout: 60_000 });

  return {
    created: newProducts.length,
    updated: productUpdates.length,
    hidden: hiddenProducts.length,
  };
}

export async function loadCatalog() {
  const [categoryRows, productRows] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  products = new Map(productRows.map((row) => [row.id, toProduct(row)]));
  categories = categoryRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      products: productRows.filter((product) => product.categoryId === row.id).map((product) => products.get(product.id)),
    }))
    .filter((category) => category.products.length > 0);
}

export function getCategories() {
  return categories;
}

export function getCategory(id) {
  return categories.find((category) => category.id === id) ?? null;
}

export function getProduct(id) {
  return products.get(id) ?? null;
}

export function getAllProducts() {
  return categories.flatMap((category) => category.products);
}

export async function setInStock(id, inStock) {
  const product = products.get(id);
  if (!product) return null;
  await prisma.product.update({ where: { id }, data: { inStock } });
  product.inStock = inStock;
  return product;
}
