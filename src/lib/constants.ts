// ─── Placeholder image URLs ───
// All food images sourced from a single constants file.

const img = (id: string, w = 600, h = 450) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80`;

export const IMAGES = {
  // Burgers
  classicSmash: img('1568901346602-db314568dbdb'),
  truffleRoyale: img('1553979459-d2229ba7433b'),
  bbqBeast: img('1572802419224-296d0aeee15d'),
  nashvilleHot: img('1513185158878-8d8c2a2a3da3'),
  paneerTikka: img('1585238342024-8ba4e5ed7408'),
  mushroomMelt: img('1550317138-10000687a72b'),

  // Sides
  loadedFries: img('1573080496219-bb080dd4f877'),
  onionRings: img('1639024471283-03518883512d'),
  nuggets: img('1562967914-01efa7e87832'),

  // Shakes & Drinks
  classicShake: img('1572490122747-3968b75cc699'),
  craftCola: img('1581006852262-e4307cf6283a'),
  lemonade: img('1621263764969-11867d3d82f3'),
} as const;
