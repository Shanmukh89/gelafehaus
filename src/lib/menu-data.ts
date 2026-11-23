import type { MenuItem, OptionGroup } from './types';
import { IMAGES } from './constants';

// ─── Shared option group templates ───

const pattyGroup: OptionGroup = {
  id: 'og-patty',
  name: 'Patty',
  type: 'single',
  required: true,
  options: [
    { id: 'opt-beef', name: 'Beef Smash', price: 0 },
    { id: 'opt-chicken', name: 'Grilled Chicken', price: 0 },
    { id: 'opt-crispy-chicken', name: 'Crispy Chicken', price: 2000 },
    { id: 'opt-plant', name: 'Plant-Based', price: 3000 },
  ],
};

const extrasGroup: OptionGroup = {
  id: 'og-extras',
  name: 'Extras',
  type: 'multi',
  required: false,
  options: [
    { id: 'opt-cheese', name: 'Extra Cheese', price: 3000 },
    { id: 'opt-bacon', name: 'Smoky Bacon', price: 5000 },
    { id: 'opt-extra-patty', name: 'Extra Patty', price: 8000 },
  ],
};

const saucesGroup: OptionGroup = {
  id: 'og-sauces',
  name: 'Sauces',
  type: 'multi',
  required: false,
  maxSelections: 2,
  options: [
    { id: 'opt-house', name: 'House Sauce', price: 0 },
    { id: 'opt-bbq', name: 'Smoky BBQ', price: 0 },
    { id: 'opt-truffle', name: 'Truffle Aioli', price: 2000 },
    { id: 'opt-sriracha', name: 'Sriracha Mayo', price: 0 },
  ],
};

const burgerOptions: OptionGroup[] = [pattyGroup, extrasGroup, saucesGroup];

const shakeFlavorGroup: OptionGroup = {
  id: 'og-shake-flavor',
  name: 'Flavour',
  type: 'single',
  required: true,
  options: [
    { id: 'opt-vanilla', name: 'Vanilla', price: 0 },
    { id: 'opt-chocolate', name: 'Chocolate', price: 0 },
    { id: 'opt-strawberry', name: 'Strawberry', price: 0 },
    { id: 'opt-oreo', name: 'Oreo', price: 2000 },
  ],
};

// ─── 12 Seed Menu Items ───

export const menuItems: MenuItem[] = [
  // ── Burgers (6) ──
  {
    id: 'item-classic-smash',
    name: 'The Classic Smash',
    description: 'Double smashed beef patty, melted cheddar, house sauce, pickles and caramelised onions on a toasted brioche bun.',
    price: 24900,
    image: IMAGES.classicSmash,
    category: 'burgers',
    available: true,
    optionGroups: burgerOptions,
  },
  {
    id: 'item-truffle-royale',
    name: 'Truffle Royale',
    description: 'Angus beef patty, truffle aioli, swiss cheese, rocket and caramelised onions on artisan sourdough.',
    price: 34900,
    image: IMAGES.truffleRoyale,
    category: 'burgers',
    available: true,
    optionGroups: burgerOptions,
  },
  {
    id: 'item-bbq-beast',
    name: 'BBQ Beast',
    description: 'Thick beef patty, smoky BBQ glaze, crispy onion rings, bacon and cheddar on a pretzel bun.',
    price: 29900,
    image: IMAGES.bbqBeast,
    category: 'burgers',
    available: true,
    optionGroups: burgerOptions,
  },
  {
    id: 'item-nashville-hot',
    name: 'Nashville Hot',
    description: 'Nashville-style spicy fried chicken, creamy slaw, dill pickles and honey drizzle on brioche.',
    price: 25900,
    image: IMAGES.nashvilleHot,
    category: 'burgers',
    available: true,
    optionGroups: [extrasGroup, saucesGroup],
  },
  {
    id: 'item-paneer-tikka',
    name: 'Paneer Tikka Burger',
    description: 'Tandoori spiced paneer patty, mint chutney, pickled onions and crisp lettuce on a whole-wheat bun.',
    price: 19900,
    image: IMAGES.paneerTikka,
    category: 'burgers',
    available: true,
    optionGroups: [extrasGroup, saucesGroup],
  },
  {
    id: 'item-mushroom-melt',
    name: 'Mushroom Swiss Melt',
    description: 'Portobello mushroom, swiss cheese, truffle mayo and caramelised onions on toasted sourdough.',
    price: 22900,
    image: IMAGES.mushroomMelt,
    category: 'burgers',
    available: false, // sold out for demo
    optionGroups: [extrasGroup, saucesGroup],
  },

  // ── Sides (3) ──
  {
    id: 'item-loaded-fries',
    name: 'Loaded Cheese Fries',
    description: 'Crispy fries topped with melted cheese, bacon bits, jalapeños and sour cream.',
    price: 14900,
    image: IMAGES.loadedFries,
    category: 'sides',
    available: true,
    optionGroups: [],
  },
  {
    id: 'item-onion-rings',
    name: 'Onion Rings',
    description: 'Beer-battered onion rings with chipotle dipping sauce.',
    price: 11900,
    image: IMAGES.onionRings,
    category: 'sides',
    available: true,
    optionGroups: [],
  },
  {
    id: 'item-nuggets',
    name: 'Chicken Nuggets (8pc)',
    description: 'Golden crispy chicken nuggets with honey mustard and BBQ sauce.',
    price: 15900,
    image: IMAGES.nuggets,
    category: 'sides',
    available: true,
    optionGroups: [],
  },

  // ── Shakes (1) ──
  {
    id: 'item-classic-shake',
    name: 'Classic Milkshake',
    description: 'Thick, creamy milkshake in your choice of flavour. Made with real ice cream.',
    price: 14900,
    image: IMAGES.classicShake,
    category: 'shakes',
    available: true,
    optionGroups: [shakeFlavorGroup],
  },

  // ── Drinks (2) ──
  {
    id: 'item-craft-cola',
    name: 'Craft Cola',
    description: 'House-made cola with natural spices and lime.',
    price: 8900,
    image: IMAGES.craftCola,
    category: 'drinks',
    available: true,
    optionGroups: [],
  },
  {
    id: 'item-lemonade',
    name: 'Fresh Lemonade',
    description: 'Freshly squeezed lemonade with mint and ginger.',
    price: 7900,
    image: IMAGES.lemonade,
    category: 'drinks',
    available: true,
    optionGroups: [],
  },
];
