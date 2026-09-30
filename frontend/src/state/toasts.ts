// Short notices that point at something the user cannot see, such as a
// preview that failed while panned off screen. A toast never carries an
// error itself: the error stays in its region, and the toast only says where.

import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

let nextId = 1;
const TOAST_MS = 6000;

export function showToast(toast: Omit<Toast, "id">) {
  const id = nextId++;
  // At most three at a time; the oldest goes first.
  useToasts.setState((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-3) }));
  setTimeout(() => dismissToast(id), TOAST_MS);
}

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
