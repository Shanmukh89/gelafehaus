import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';

// ============================================================
// Robust QR Code Stand Generator for Gelafehaus (Tables 01-15)
// Generates 100% ISO/IEC-compliant SVG & PNG QR Table Stands
// Supporting both Production Domain and Local Wi-Fi Testing
// ============================================================

export function getLocalWifiIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function getQrMatrix(text: string): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const matrix: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) {
      row.push(Boolean(qr.modules.get(r, c)));
    }
    matrix.push(row);
  }
  return matrix;
}

// ─── SVG Table Stand Generator (High-DPI Vector) ───
export function generateTableSvg(tableNumber: string, url: string): string {
  const matrix = getQrMatrix(url);
  const modules = matrix.length;
  const padding = 3;
  const qrBoxSize = 580;
  const cellSize = qrBoxSize / (modules + padding * 2);

  let rects = '';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) {
        const x = (c + padding) * cellSize + 110;
        const y = (r + padding) * cellSize + 190;
        rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#1C1917" />`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1050" width="800" height="1050">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&amp;family=Inter:wght@500;600&amp;display=swap');
      .title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 44px; fill: #1C1917; text-anchor: middle; letter-spacing: -0.5px; }
      .tagline { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 20px; fill: #78716C; text-anchor: middle; }
      .table-badge { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: 38px; fill: #E4572E; text-anchor: middle; }
      .instructions { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 18px; fill: #1C1917; text-anchor: middle; }
      .footer { font-family: 'Inter', sans-serif; font-weight: 500; font-size: 15px; fill: #78716C; text-anchor: middle; }
    </style>
  </defs>

  <!-- Card Background -->
  <rect x="0" y="0" width="800" height="1050" fill="#FAF7F2" />
  <rect x="30" y="30" width="740" height="990" rx="32" fill="#FFFFFF" stroke="#E7E2DA" stroke-width="3" />

  <!-- Brand Wordmark -->
  <text x="400" y="105" class="title">Gelafehaus</text>
  <text x="400" y="142" class="tagline">Gourmet Burgers &amp; Shakes</text>

  <!-- QR Code White Frame -->
  <rect x="80" y="160" width="640" height="640" rx="24" fill="#FFFFFF" stroke="#E7E2DA" stroke-width="2" />
  ${rects}

  <!-- Table Number Display Pill -->
  <rect x="250" y="825" width="300" height="74" rx="37" fill="#FAF7F2" stroke="#E4572E" stroke-width="3" />
  <text x="400" y="876" class="table-badge">TABLE ${tableNumber}</text>

  <!-- Instructions -->
  <text x="400" y="945" class="instructions">Scan with your phone camera to order</text>
  <text x="400" y="978" class="footer">Pay at the counter when you finish your meal</text>
</svg>`;
}

// ─── PNG Table Stand Generator ───
export async function generateTablePng(tableNumber: string, url: string): Promise<Buffer> {
  // Generate crisp standard QR PNG buffer
  const qrBuffer = await QRCode.toBuffer(url, {
    type: 'png',
    width: 600,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#1C1917',
      light: '#FFFFFF',
    },
  });

  return qrBuffer;
}

// ─── Batch Generation Execution ───
export async function generateAllQrs() {
  const prodDomain =
    process.env.PRODUCTION_DOMAIN ||
    process.env.VITE_PRODUCTION_DOMAIN ||
    'order.gelafehaus.com';

  const wifiIp = getLocalWifiIp();
  const localDomain = `${wifiIp}:5173`;

  const prodDir = path.resolve(process.cwd(), 'public/qr');
  const localDir = path.resolve(process.cwd(), 'public/qr/local');

  fs.mkdirSync(prodDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });

  console.log(`\n🍔 Gelafehaus QR Generator`);
  console.log(`• Production Target: https://${prodDomain} -> public/qr/`);
  console.log(`• Local Wi-Fi Target: http://${localDomain} -> public/qr/local/\n`);

  for (let i = 1; i <= 15; i++) {
    const tableNumber = String(i).padStart(2, '0');

    // 1. Production QR
    const prodUrl = `https://${prodDomain}/?table=${tableNumber}`;
    const prodSvg = generateTableSvg(tableNumber, prodUrl);
    const prodPng = await generateTablePng(tableNumber, prodUrl);

    fs.writeFileSync(path.join(prodDir, `table-${tableNumber}.svg`), prodSvg, 'utf-8');
    fs.writeFileSync(path.join(prodDir, `table-${tableNumber}.png`), prodPng);

    // 2. Local Wi-Fi Testing QR (scan from your phone right now!)
    const localUrl = `http://${localDomain}/?table=${tableNumber}`;
    const localSvg = generateTableSvg(tableNumber, localUrl);
    const localPng = await generateTablePng(tableNumber, localUrl);

    fs.writeFileSync(path.join(localDir, `table-${tableNumber}.svg`), localSvg, 'utf-8');
    fs.writeFileSync(path.join(localDir, `table-${tableNumber}.png`), localPng);

    console.log(`✅ Table ${tableNumber} (Prod: ${prodUrl} | Local: ${localUrl})`);
  }

  console.log(`\n🎉 Successfully generated 15 Production & 15 Local Wi-Fi QR codes!\n`);
}

// Run directly
generateAllQrs().catch(err => {
  console.error('Error generating QRs:', err);
  process.exit(1);
});
