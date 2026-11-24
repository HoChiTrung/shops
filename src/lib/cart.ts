import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CartItem } from '../shared/types.ts';

function getStorageKey(slug: string): string {
  return `cart_${slug.trim().toLowerCase()}`;
}

function readCart(slug: string): CartItem[] {
  try {
    const raw = window.localStorage.getItem(getStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useShopCart(slug: string) {
  const [items, setItems] = useState<CartItem[]>(() => readCart(slug));

  useEffect(() => {
    setItems(readCart(slug));
  }, [slug]);

  useEffect(() => {
    try {
      window.localStorage.setItem(getStorageKey(slug), JSON.stringify(items));
    } catch {
      // Ignore storage quota errors in private mode
    }
  }, [slug, items]);

  const addItem = useCallback((newItem: CartItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((item) => item.variantId === newItem.variantId);
      if (idx === -1) {
        return [...prev, newItem];
      }
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        quantity: Math.min(99, next[idx].quantity + newItem.quantity),
        unitPrice: newItem.unitPrice,
      };
      return next;
    });
  }, []);

  const updateQuantity = useCallback((variantId: string, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) {
        return prev.filter((item) => item.variantId !== variantId);
      }
      return prev.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.min(99, Math.max(1, quantity)) }
          : item
      );
    });
  }, []);

  const removeItem = useCallback((variantId: string) => {
    setItems((prev) => prev.filter((item) => item.variantId !== variantId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const totalItems = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const totalAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items]
  );

  return {
    items,
    totalItems,
    totalAmount,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
  };
}
