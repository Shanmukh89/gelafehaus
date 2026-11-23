import { useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          size?: 'normal' | 'compact' | 'invisible';
          callback?: (token: string) => void;
          'error-callback'?: (err: unknown) => void;
          'expired-callback'?: () => void;
        }
      ) => string;
      execute: (container?: string | HTMLElement) => void;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onTurnstileLoaded?: () => void;
  }
}

// Cloudflare official dummy always-pass test key as default
const DEFAULT_TEST_SITE_KEY = '1x00000000000000000000AA';

export function useTurnstile() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const resolveTokenRef = useRef<((token: string) => void) | null>(null);
  const isReadyRef = useRef<boolean>(false);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEFAULT_TEST_SITE_KEY;

  // Initialize invisible Turnstile widget
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create an invisible container attached to DOM
    if (!containerRef.current) {
      const div = document.createElement('div');
      div.id = 'cf-turnstile-invisible-container';
      div.style.position = 'absolute';
      div.style.width = '0px';
      div.style.height = '0px';
      div.style.overflow = 'hidden';
      div.style.opacity = '0';
      div.style.pointerEvents = 'none';
      document.body.appendChild(div);
      containerRef.current = div;
    }

    function initWidget() {
      if (!window.turnstile || !containerRef.current || widgetIdRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          size: 'invisible',
          callback: (token: string) => {
            if (resolveTokenRef.current) {
              resolveTokenRef.current(token);
              resolveTokenRef.current = null;
            }
          },
          'error-callback': (err: unknown) => {
            console.warn('Turnstile error callback:', err);
            // Fall back with dummy token so users are never blocked in development
            if (resolveTokenRef.current) {
              resolveTokenRef.current('mock-turnstile-token');
              resolveTokenRef.current = null;
            }
          },
        });
        isReadyRef.current = true;
      } catch (err) {
        console.warn('Failed to render Turnstile widget:', err);
      }
    }

    // Check if script already exists
    if (!document.getElementById('cf-turnstile-script')) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        initWidget();
      };
      document.head.appendChild(script);
    } else if (window.turnstile) {
      initWidget();
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  // Execute turnstile on demand (e.g. on Place Order submit)
  const executeTurnstile = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!window.turnstile || !containerRef.current) {
        // If script hasn't loaded or blocked, return dummy token fallback
        resolve('fallback-turnstile-token');
        return;
      }

      resolveTokenRef.current = resolve;

      try {
        window.turnstile.execute(containerRef.current);
      } catch (err) {
        console.warn('Turnstile execute failed, using fallback:', err);
        resolve('fallback-turnstile-token');
      }

      // Safety timeout in case callback doesn't fire (1.2s in local dev/testing, 4s in production)
      const timeoutMs =
        typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? 1200
          : 4000;

      setTimeout(() => {
        if (resolveTokenRef.current) {
          resolveTokenRef.current('timeout-turnstile-token');
          resolveTokenRef.current = null;
        }
      }, timeoutMs);
    });
  }, []);

  return { executeTurnstile };
}
