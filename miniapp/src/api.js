import { getInitData } from './telegram.js';

export class ApiError extends Error {
  constructor(body, status) {
    super(body?.message || body?.error || 'Ошибка сервера');
    this.code = body?.error ?? 'SERVER_ERROR';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `tma ${getInitData()}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // ответ без тела (не ожидается, но не должно ломать приложение)
  }
  if (!response.ok) throw new ApiError(body, response.status);
  return body;
}

export const api = {
  bootstrap: () => request('/bootstrap'),
  setLanguage: (lang) => request('/language', { method: 'POST', body: { lang } }),
  setCartItem: (productId, quantity) => request('/cart/items', { method: 'POST', body: { productId, quantity } }),
  clearCart: () => request('/cart/clear', { method: 'POST' }),
  checkout: (payload) => request('/checkout', { method: 'POST', body: payload }),
  getOrders: () => request('/orders'),
  repeatOrder: (id) => request(`/orders/${id}/repeat`, { method: 'POST' }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST' }),
};
