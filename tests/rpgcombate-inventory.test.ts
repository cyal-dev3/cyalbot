import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_USER, type UserRPG } from '../src/types/user.js';
import { ITEMS, FORGE_MATERIALS } from '../src/types/rpg.js';
import { LIMITS } from '../src/constants/rpg.js';
import {
  addItem, addLoot, addMaterial, consumeMaterials, countItem, findEquippedEntry, inventorySize, isEquipped,
  migrateLegacyMaterials, missingMaterials, removeItem, removeMaterial, resolveItem
} from '../src/lib/rpg-inventory.js';

const freshUser = (): UserRPG => structuredClone(DEFAULT_USER);

test('addItem apila consumibles y equipo sin mejorar; rechaza ids y cantidades inválidas', () => {
  const user = freshUser();
  assert.deepEqual(addItem(user, 'pocion_salud', 3), { ok: true, added: 3, reason: undefined });
  assert.deepEqual(addItem(user, 'pocion_salud', 2), { ok: true, added: 2, reason: undefined });
  assert.equal(user.inventory.length, 1);
  assert.equal(countItem(user, 'pocion_salud'), 5);

  assert.equal(addItem(user, 'no_existe').reason, 'unknown');
  assert.equal(addItem(user, 'pocion_salud', 0).reason, 'invalid');
  assert.equal(addItem(user, 'pocion_salud', NaN).reason, 'invalid');
  assert.equal(countItem(user, 'pocion_salud'), 5);
});

test('addItem: los equipables mejorados son entradas únicas delante del montón', () => {
  const user = freshUser();
  addItem(user, 'espada_hierro', 2);
  addItem(user, 'espada_hierro', 1, { enhanceLevel: 3 });
  addItem(user, 'espada_hierro', 2, { enhanceLevel: 5 });

  assert.equal(countItem(user, 'espada_hierro'), 5);
  assert.equal(user.inventory.length, 4);
  // La primera entrada del item es una mejorada: es la que lee calculateTotalStats
  assert.equal(user.inventory[0].enhanceLevel, 5);
  assert.equal(user.inventory[0].quantity, 1);
  assert.equal(user.inventory[1].enhanceLevel, 5);
  assert.equal(user.inventory[2].enhanceLevel, 3);
  assert.equal(user.inventory[3].enhanceLevel, undefined);
  assert.equal(user.inventory[3].quantity, 2);

  // Un consumible ignora enhanceLevel
  addItem(user, 'vendaje', 1, { enhanceLevel: 4 });
  assert.equal(user.inventory.find(i => i.itemId === 'vendaje')?.enhanceLevel, undefined);
});

test('addItem respeta MAX_INVENTORY_SIZE y añade solo lo que cabe', () => {
  const user = freshUser();
  const first = addItem(user, 'vendaje', LIMITS.MAX_INVENTORY_SIZE - 2);
  assert.equal(first.ok, true);
  const partial = addItem(user, 'pocion_mana', 5);
  assert.equal(partial.ok, false);
  assert.equal(partial.added, 2);
  assert.equal(partial.reason, 'full');
  assert.equal(inventorySize(user), LIMITS.MAX_INVENTORY_SIZE);
  const none = addItem(user, 'pocion_mana', 1);
  assert.deepEqual(none, { ok: false, added: 0, reason: 'full' });
});

test('removeItem falla sin tocar nada si no hay suficientes y quita primero lo no mejorado', () => {
  const user = freshUser();
  addItem(user, 'espada_hierro', 2);
  addItem(user, 'espada_hierro', 1, { enhanceLevel: 2 });

  assert.equal(removeItem(user, 'espada_hierro', 4), false);
  assert.equal(countItem(user, 'espada_hierro'), 3);

  assert.equal(removeItem(user, 'espada_hierro', 2), true);
  assert.equal(countItem(user, 'espada_hierro'), 1);
  assert.equal(user.inventory[0].enhanceLevel, 2, 'sobrevive la mejorada');

  assert.equal(removeItem(user, 'espada_hierro', 1, { enhanceLevel: 0 }), false, 'no hay unidades +0');
  assert.equal(removeItem(user, 'espada_hierro', 1, { enhanceLevel: 2 }), true);
  assert.equal(user.inventory.length, 0);
  assert.equal(removeItem(user, 'espada_hierro', 1), false);
});

test('resolveItem: exacto > empieza por > contiene, y lista la ambigüedad sin actuar', () => {
  const items = Object.values(ITEMS);

  const exactId = resolveItem('espada_hierro', items);
  assert.equal(exactId.status, 'found');
  if (exactId.status === 'found') assert.equal(exactId.item.id, 'espada_hierro');

  const exactName = resolveItem('Poción de Salud', items);
  assert.equal(exactName.status, 'found', 'el nombre exacto gana aunque "pocion de salud" sea prefijo de otros');
  if (exactName.status === 'found') assert.equal(exactName.item.id, 'pocion_salud');

  const prefix = resolveItem('pocion de salud m', items);
  assert.equal(prefix.status, 'ambiguous');
  if (prefix.status === 'ambiguous') {
    assert.deepEqual(prefix.candidates.map(c => c.id).sort(), ['pocion_salud_mayor', 'pocion_salud_menor']);
  }

  const contains = resolveItem('dragon', items);
  assert.equal(contains.status, 'ambiguous');

  const unique = resolveItem('celestial', items);
  assert.equal(unique.status, 'ambiguous');
  const uniqueArmor = resolveItem('armadura celestial', items);
  assert.equal(uniqueArmor.status, 'found');

  assert.equal(resolveItem('', items).status, 'none');
  assert.equal(resolveItem('zzzz', items).status, 'none');
});

test('isEquipped y findEquippedEntry eligen la pieza de mayor nivel de forja', () => {
  const user = freshUser();
  addItem(user, 'espada_hierro', 1);
  addItem(user, 'espada_hierro', 1, { enhanceLevel: 4 });
  user.equipment.weapon = 'espada_hierro';
  assert.equal(isEquipped(user, 'espada_hierro'), 'weapon');
  assert.equal(isEquipped(user, 'vendaje'), null);
  assert.equal(findEquippedEntry(user, 'weapon')?.enhanceLevel, 4);
  assert.equal(findEquippedEntry(user, 'armor'), null);
});

test('materiales: addMaterial/removeMaterial/consumeMaterials son atómicos y addLoot enruta', () => {
  const user = freshUser();
  assert.equal(addMaterial(user, 'hierro', 5), true);
  assert.equal(addMaterial(user, 'no_existe', 5), false);
  assert.equal(user.forgeMaterials.hierro, 5);

  assert.equal(removeMaterial(user, 'hierro', 6), false);
  assert.equal(user.forgeMaterials.hierro, 5);

  const req = [{ materialId: 'hierro', quantity: 3 }, { materialId: 'carbon', quantity: 2 }];
  assert.deepEqual(missingMaterials(user, req), [{ materialId: 'carbon', quantity: 2, have: 0 }]);
  assert.equal(consumeMaterials(user, req), false);
  assert.equal(user.forgeMaterials.hierro, 5, 'no consume nada si falta alguno');

  addMaterial(user, 'carbon', 2);
  assert.equal(consumeMaterials(user, req), true);
  assert.equal(user.forgeMaterials.hierro, 2);
  assert.equal(user.forgeMaterials.carbon, undefined);

  assert.equal(addLoot(user, 'oro', 2), 'material');
  assert.equal(addLoot(user, 'pocion_salud', 1), 'item');
  assert.equal(addLoot(user, 'nada', 1), 'unknown');
  assert.equal(user.forgeMaterials.oro, 2);
  assert.equal(countItem(user, 'pocion_salud'), 1);
  assert.ok(FORGE_MATERIALS.oro);
});

test('migrateLegacyMaterials mueve los items de material antiguos a forgeMaterials', () => {
  const user = freshUser();
  user.inventory = [
    { itemId: 'oro_material', quantity: 3 },
    { itemId: 'cristal_mana', quantity: 2 },
    { itemId: 'pocion_salud', quantity: 1 }
  ];
  assert.equal(migrateLegacyMaterials(user), true);
  assert.deepEqual(user.inventory, [{ itemId: 'pocion_salud', quantity: 1 }]);
  assert.equal(user.forgeMaterials.oro, 3);
  assert.equal(user.forgeMaterials.cristal, 2);
  assert.equal(migrateLegacyMaterials(user), false);
});
