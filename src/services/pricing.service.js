import { restaurant } from '../core/restaurant.js';

export function getDeliveryFee(itemsTotal) {
  const { delivery } = restaurant.data;
  if (!delivery.enabled) return 0;
  if (delivery.freeFrom > 0 && itemsTotal >= delivery.freeFrom) return 0;
  return delivery.price;
}

export function meetsDeliveryMinimum(itemsTotal) {
  const { minOrder } = restaurant.data.delivery;
  return !(minOrder > 0 && itemsTotal < minOrder);
}
