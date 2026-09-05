// The kitchen's food, as data.
//
// Everything the sim knows about an ingredient — how it must be prepared, and
// which vessel (if any) it must go through — lives in INGREDIENTS. Everything
// it knows about a dish lives in DISHES. Nothing else in the codebase may
// hard-code "soup is three chopped things boiled in a pot": levels declare a
// menu of DishIds, and the rules below derive the rest.
//
// Pure data + pure functions. Safe to import from the server, the host
// renderer, the controller and the demo bots alike.

import type { Ingredient } from './types';

export type IngredientType =
  // soup vegetables
  | 'onion'
  | 'tomato'
  | 'mushroom'
  // burgers and salads
  | 'lettuce'
  | 'cheese'
  | 'bun'
  | 'meat'
  // sushi
  | 'rice'
  | 'fish'
  | 'seaweed';

export interface IngredientDef {
  id: IngredientType;
  label: string;
  /** Must be chopped on a board before it counts as prepared. */
  chop: boolean;
  /** Vessel it must pass through: a pot boils, a pan fries, null = neither. */
  cook: 'boil' | 'fry' | null;
  /**
   * How many of this ingredient a pot cooks at once, and therefore how many
   * it takes before the pot starts. Soup vegetables come in threes; rice is
   * a single batch. Only meaningful when `cook === 'boil'`.
   */
  boilBatch?: number;
  /** Renderer defaults. Sprite assets may replace the drawing, not the data. */
  color: string;
  accent: string;
}

/**
 * Prep rules. A part of a dish is only "ready" once every rule here is met,
 * which is what stops a player plating a raw patty or an unchopped onion.
 *
 * Note the deliberate asymmetry: the soup vegetables boil, the salad/burger
 * greens do not. That is a property of the ingredient, never of the dish —
 * there are no per-dish prep overrides, so a dish that wants raw tomato has
 * to use a different vegetable instead.
 */
export const INGREDIENTS: Record<IngredientType, IngredientDef> = {
  onion: {
    id: 'onion',
    label: 'Onion',
    chop: true,
    cook: 'boil',
    boilBatch: 3,
    color: '#f2e2b4',
    accent: '#4fae54',
  },
  tomato: {
    id: 'tomato',
    label: 'Tomato',
    chop: true,
    cook: 'boil',
    boilBatch: 3,
    color: '#e8503a',
    accent: '#3f9b4b',
  },
  mushroom: {
    id: 'mushroom',
    label: 'Mushroom',
    chop: true,
    cook: 'boil',
    boilBatch: 3,
    color: '#b4784f',
    accent: '#f6e9d2',
  },
  lettuce: {
    id: 'lettuce',
    label: 'Lettuce',
    chop: true,
    cook: null,
    color: '#7ec850',
    accent: '#3f8c33',
  },
  cheese: {
    id: 'cheese',
    label: 'Cheese',
    chop: true,
    cook: null,
    color: '#f6c23a',
    accent: '#d99a12',
  },
  bun: {
    id: 'bun',
    label: 'Bun',
    chop: false,
    cook: null,
    color: '#e2a961',
    accent: '#f7e3bc',
  },
  meat: {
    id: 'meat',
    label: 'Patty',
    chop: true,
    cook: 'fry',
    color: '#d05a52',
    accent: '#6d3a26',
  },
  rice: {
    id: 'rice',
    label: 'Rice',
    chop: false,
    cook: 'boil',
    boilBatch: 1,
    color: '#f8f5ec',
    accent: '#ded7c4',
  },
  fish: {
    id: 'fish',
    label: 'Fish',
    chop: true,
    cook: null,
    color: '#f4907a',
    accent: '#ffdccf',
  },
  seaweed: {
    id: 'seaweed',
    label: 'Nori',
    chop: false,
    cook: null,
    color: '#2f4f3a',
    accent: '#16281d',
  },
};

/** Pot batch size for a boiling ingredient; 1 for everything else. */
export function boilBatchOf(type: IngredientType): number {
  return INGREDIENTS[type].boilBatch ?? 1;
}

/** Largest batch any ingredient boils in — the pot's physical capacity. */
export const MAX_BOIL_BATCH = 3;

/** What a dish is, roughly: drives plating art and the demo bots' planning. */
export type Course = 'soup' | 'salad' | 'burger' | 'sushi';

/**
 * The full recipe book. `parts` is a multiset — repeats are meaningful, order
 * is not (DISHES stores it sorted so `Order.recipe` comparisons are cheap).
 *
 * A two-vegetable soup is named after the doubled vegetable first, so
 * "Double Onion & Tomato" and "Double Tomato & Onion" are different soups.
 */
const TABLE = {
  // --- soups: every 3-multiset of the three boiling vegetables ---
  'onion-soup': { name: 'Onion Soup', course: 'soup', parts: ['onion', 'onion', 'onion'] },
  'tomato-soup': { name: 'Tomato Soup', course: 'soup', parts: ['tomato', 'tomato', 'tomato'] },
  'mushroom-soup': {
    name: 'Mushroom Soup',
    course: 'soup',
    parts: ['mushroom', 'mushroom', 'mushroom'],
  },
  'onion-tomato-soup': {
    name: 'Double Onion & Tomato',
    course: 'soup',
    parts: ['onion', 'onion', 'tomato'],
  },
  'tomato-onion-soup': {
    name: 'Double Tomato & Onion',
    course: 'soup',
    parts: ['tomato', 'tomato', 'onion'],
  },
  'onion-mushroom-soup': {
    name: 'Double Onion & Mushroom',
    course: 'soup',
    parts: ['onion', 'onion', 'mushroom'],
  },
  'mushroom-onion-soup': {
    name: 'Double Mushroom & Onion',
    course: 'soup',
    parts: ['mushroom', 'mushroom', 'onion'],
  },
  'tomato-mushroom-soup': {
    name: 'Double Tomato & Mushroom',
    course: 'soup',
    parts: ['tomato', 'tomato', 'mushroom'],
  },
  'mushroom-tomato-soup': {
    name: 'Double Mushroom & Tomato',
    course: 'soup',
    parts: ['mushroom', 'mushroom', 'tomato'],
  },
  'garden-soup': {
    name: 'Garden Soup',
    course: 'soup',
    parts: ['onion', 'tomato', 'mushroom'],
  },

  // --- the no-cook course: a level can be all knife work ---
  'side-salad': { name: 'Side Salad', course: 'salad', parts: ['lettuce', 'cheese'] },

  // --- burgers: the patty has to be chopped and then fried ---
  burger: { name: 'Burger', course: 'burger', parts: ['bun', 'meat'] },
  cheeseburger: { name: 'Cheeseburger', course: 'burger', parts: ['bun', 'meat', 'cheese'] },
  'salad-burger': { name: 'Salad Burger', course: 'burger', parts: ['bun', 'meat', 'lettuce'] },
  'deluxe-burger': {
    name: 'Deluxe Burger',
    course: 'burger',
    parts: ['bun', 'meat', 'cheese', 'lettuce'],
  },

  // --- sushi: rice boils one portion at a time ---
  nigiri: { name: 'Nigiri', course: 'sushi', parts: ['rice', 'fish'] },
  maki: { name: 'Maki Roll', course: 'sushi', parts: ['rice', 'fish', 'seaweed'] },
  'veggie-roll': { name: 'Veggie Roll', course: 'sushi', parts: ['rice', 'seaweed', 'lettuce'] },
} as const satisfies Record<
  string,
  { name: string; course: Course; parts: readonly IngredientType[] }
>;

export type DishId = keyof typeof TABLE;

export interface DishDef {
  id: DishId;
  name: string;
  course: Course;
  /** Sorted, so two recipes for the same dish are `===` element by element. */
  parts: IngredientType[];
}

export const DISHES: Record<DishId, DishDef> = Object.fromEntries(
  Object.entries(TABLE).map(([id, d]) => [
    id,
    { id: id as DishId, name: d.name, course: d.course, parts: [...d.parts].sort() },
  ]),
) as Record<DishId, DishDef>;

export const DISH_IDS = Object.keys(DISHES) as DishId[];

/** Every dish of one course, in catalogue order. */
export function dishesOfCourse(course: Course): DishId[] {
  return DISH_IDS.filter((id) => DISHES[id].course === course);
}

/** The starter kitchen's menu. Levels (Plan 04) override this. */
export const DEFAULT_MENU: DishId[] = [...dishesOfCourse('soup')];

/* ------------------------------ prep rules ------------------------------ */

/** True once an ingredient has had every preparation its definition demands. */
export function isReady(ing: Ingredient): boolean {
  const def = INGREDIENTS[ing.type];
  return (!def.chop || ing.chopped) && (def.cook === null || ing.cooked);
}

/** A fresh ingredient straight out of a crate. */
export function rawIngredient(type: IngredientType): Ingredient {
  return { type, chopped: false, cooked: false };
}

/* --------------------------- multiset helpers --------------------------- */

function counts(parts: readonly IngredientType[]): Map<IngredientType, number> {
  const m = new Map<IngredientType, number>();
  for (const p of parts) m.set(p, (m.get(p) ?? 0) + 1);
  return m;
}

/** Every element of `sub` appears in `sup` at least as often. */
export function isSubMultiset(
  sub: readonly IngredientType[],
  sup: readonly IngredientType[],
): boolean {
  if (sub.length > sup.length) return false;
  const have = counts(sup);
  for (const [type, n] of counts(sub)) if ((have.get(type) ?? 0) < n) return false;
  return true;
}

/** Multiset equality (order-insensitive). */
export function sameMultiset(
  a: readonly IngredientType[],
  b: readonly IngredientType[],
): boolean {
  return a.length === b.length && isSubMultiset(a, b);
}

/* ----------------------------- plating rule ----------------------------- */

/**
 * The one rule every plate-filling path in the sim goes through.
 *
 * A part may join a plate when it is fully prepared AND the plate would still
 * be on its way to *something* the kitchen is allowed to sell. That single
 * condition replaces every hard-coded recipe check: it stops a chef stacking
 * four patties, and it lets a cheeseburger be assembled in any order, because
 * both [bun] + cheese and [cheese] + bun are sub-multisets of the same dish.
 */
export function canAddToPlate(
  contents: readonly Ingredient[],
  ing: Ingredient,
  menu: readonly DishId[],
): boolean {
  if (!isReady(ing)) return false;
  const want = [...contents.map((c) => c.type), ing.type];
  return menu.some((id) => isSubMultiset(want, DISHES[id].parts));
}

/** The dish a finished plate is, if it is any dish on the menu. */
export function dishOfPlate(
  contents: readonly Ingredient[],
  menu: readonly DishId[],
): DishId | null {
  const parts = contents.map((c) => c.type);
  return menu.find((id) => sameMultiset(parts, DISHES[id].parts)) ?? null;
}

/* --------------------------- menu feasibility --------------------------- */

/** What a level's stations can actually do, for the startup menu check. */
export interface KitchenCapabilities {
  crates: ReadonlySet<IngredientType>;
  boards: number;
  pots: number;
  pans: number;
}

/**
 * Refuse to start a round whose menu cannot be cooked. A missing crate or a
 * missing pan is a level-design typo, and it is far cheaper to catch here
 * than to watch an unfillable order tick down to −10 on the TV.
 */
export function assertMenuMakeable(menu: readonly DishId[], kit: KitchenCapabilities): void {
  if (menu.length === 0) throw new Error('menu: a round needs at least one dish');
  for (const id of menu) {
    const dish = DISHES[id];
    if (!dish) throw new Error(`menu: unknown dish ${JSON.stringify(id)}`);
    for (const part of dish.parts) {
      const def = INGREDIENTS[part];
      if (!kit.crates.has(part)) {
        throw new Error(`menu: ${dish.name} needs a ${def.label} crate`);
      }
      if (def.chop && kit.boards < 1) {
        throw new Error(`menu: ${dish.name} needs a cutting board for ${def.label}`);
      }
      if (def.cook === 'boil' && kit.pots < 1) {
        throw new Error(`menu: ${dish.name} needs a pot to boil ${def.label}`);
      }
      if (def.cook === 'fry' && kit.pans < 1) {
        throw new Error(`menu: ${dish.name} needs a pan to fry ${def.label}`);
      }
    }
  }
}
