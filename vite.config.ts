import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Lightweight dev-sync plugin so multiple devices (e.g. phone customer & laptop admin)
// share live orders in real time over local Wi-Fi even in offline/demo mode without Docker/Supabase.
function devSyncPlugin(): Plugin {
  const sharedOrders: any[] = [];

  return {
    name: 'dev-sync-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/_dev_sync/')) return next();
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/_dev_sync/orders' && req.method === 'GET') {
          return res.end(JSON.stringify(sharedOrders));
        }

        if (req.url === '/_dev_sync/orders' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const order = JSON.parse(body);
              const idx = sharedOrders.findIndex(o => o.id === order.id);
              if (idx !== -1) {
                sharedOrders[idx] = order;
              } else {
                sharedOrders.unshift(order);
              }
              return res.end(JSON.stringify({ success: true, order }));
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

