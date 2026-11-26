import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Lightweight dev-sync plugin so multiple devices (e.g. phone customer & laptop admin)
// share live orders in real time over local Wi-Fi even in offline/demo mode without Docker/Supabase.
function devSyncPlugin(): Plugin {
  const sharedOrders: any[] = [];
  const dailyCounters = new Map<string, number>();
  const sseClients = new Set<any>();

  function broadcastEvent(payload: any) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return {
    name: 'dev-sync-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/_dev_sync/')) return next();

        if (req.url === '/_dev_sync/events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
          sseClients.add(res);
          req.on('close', () => {
            sseClients.delete(res);
          });
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/_dev_sync/orders' && req.method === 'GET') {
          return res.end(JSON.stringify(sharedOrders));
        }

        if (req.url === '/_dev_sync/orders' && req.method === 'DELETE') {
          sharedOrders.length = 0;
          dailyCounters.clear();
          return res.end(JSON.stringify({ success: true }));
        }

        if (req.url === '/_dev_sync/orders' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const incoming = JSON.parse(body);
              const today = new Date().toISOString().split('T')[0];

              // 1. Existing order update (status/payment change)
              const existingIdx = sharedOrders.findIndex(o => o.id === incoming.id);
              if (existingIdx !== -1) {
                sharedOrders[existingIdx] = {
                  ...sharedOrders[existingIdx],
                  ...incoming,
                  orderNumber: sharedOrders[existingIdx].orderNumber,
                };
                broadcastEvent({
                  type: 'order_updated',
                  orderId: sharedOrders[existingIdx].id,
                });
                return res.end(JSON.stringify({ success: true, order: sharedOrders[existingIdx] }));
              }

              // 2. Idempotency check on new order creation
              if (incoming.idempotencyKey) {
                const dup = sharedOrders.find(o => o.idempotencyKey === incoming.idempotencyKey);
                if (dup) {
                  return res.end(JSON.stringify({ success: true, order: dup }));
                }
              }

              // 3. Atomic sequential daily order number starting at 101
              const prevNum = dailyCounters.get(today) ?? 100;
              const nextNum = prevNum + 1;
              dailyCounters.set(today, nextNum);

              const storedOrder = {
                ...incoming,
                orderNumber: nextNum,
                orderDate: today,
              };
              sharedOrders.unshift(storedOrder);

              broadcastEvent({
                type: 'order_inserted',
                orderId: storedOrder.id,
              });
              return res.end(JSON.stringify({ success: true, order: storedOrder }));
            } catch {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devSyncPlugin()],
  server: {
    host: true, // Listen on 0.0.0.0 so phone and laptop can connect over local Wi-Fi
  },
});

