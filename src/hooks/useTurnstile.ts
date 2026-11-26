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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptFailedRef = useRef(false);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEFAULT_TEST_SITE_KEY;

  const finishToken = useCallback((token: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (resolveTokenRef.current) {
      const fn = resolveTokenRef.current;
      resolveTokenRef.current = null;
      fn(token);
    }
  }, []);

  // Initialize Turnstile widget
  useEffect(() => {
    if (typeof window === 'undefined') return;

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
          size: 'normal',
          callback: (token: string) => {
            finishToken(token);
          },
          'error-callback': (err: unknown) => {
            console.warn('Turnstile error callback:', err);
            finishToken('mock-turnstile-token');
          },
        });
      } catch (err) {
        console.warn('Failed to render Turnstile widget:', err);
        scriptFailedRef.current = true;
      }
    }

    const existingScript = document.getElementById('cf-turnstile-script') as HTMLScriptElement | null;
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        initWidget();
      };
      script.onerror = () => {
        scriptFailedRef.current = true;
        finishToken('script-error-turnstile-token');
      };
      document.head.appendChild(script);
    } else if (window.turnstile) {
      initWidget();
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, finishToken]);

  // Execute turnstile on demand (e.g. on Place Order submit)
  const executeTurnstile = useCallback((): Promise<string> => {
    return new Promise(resolve => {
      if (scriptFailedRef.current || !window.turnstile || !containerRef.current || !widgetIdRef.current) {
        resolve('fallback-turnstile-token');
        return;
      }

      resolveTokenRef.current = resolve;

      timerRef.current = setTimeout(() => {
        finishToken('timeout-turnstile-token');
      }, 1500);

      try {
        window.turnstile.reset(widgetIdRef.current);
        window.turnstile.execute(widgetIdRef.current);
      } catch (err) {
        console.warn('Turnstile execute failed, using fallback:', err);
        finishToken('fallback-turnstile-token');
      }
    });
  }, [finishToken]);

  return { executeTurnstile };
}
