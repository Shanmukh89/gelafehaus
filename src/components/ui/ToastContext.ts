import { createContext } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastContextType {
  toast: (message: string, typeOrOptions?: ToastType | ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextType>({ toast: () => {} });
