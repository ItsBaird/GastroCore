import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRODUCTS, photoFileName, placeholderSvg } from './data.js';
import { seedUuid } from './ids.js';

describe('catalogo de demostracion', () => {
  it('cada producto pertenece a una categoria que existe y no se repite (categoria, nombre)', () => {
    const names = new Set(CATEGORIES.map((c) => c.name));
    for (const p of PRODUCTS) expect(names.has(p.category)).toBe(true);
    const keys = PRODUCTS.map((p) => `${p.category}|${p.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('los slugs son unicos: de ahi salen los ids que usa Orders (seedUuid(product:slug))', () => {
    const slugs = PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(seedUuid('product:limonada-natural')).toBe('010f9724-a9b3-5c3b-886d-22ba18ab2f33');
    expect(slugs).toContain('limonada-natural');
    expect(slugs).toContain('palitos-de-ajo');
  });

  it('cumple las restricciones de las columnas: precio entero >= 0, nombres cortos', () => {
    for (const c of CATEGORIES) expect(c.name.length).toBeLessThanOrEqual(80);
    for (const p of PRODUCTS) {
      expect(Number.isInteger(p.price) && p.price >= 0).toBe(true);
      expect(p.name.length).toBeLessThanOrEqual(120);
      expect(`/api/catalog/photos/${photoFileName(p.slug)}`.length).toBeLessThanOrEqual(255);
    }
  });

  it('hay variedad: todas las categorias tienen productos y al menos uno esta agotado', () => {
    for (const c of CATEGORIES) expect(PRODUCTS.some((p) => p.category === c.name)).toBe(true);
    expect(PRODUCTS.filter((p) => p.isAvailable === false).map((p) => p.slug)).toEqual([
      'tiramisu',
    ]);
  });

  it('el orden de las categorias es distinto y creciente', () => {
    const orders = CATEGORIES.map((c) => c.displayOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('placeholderSvg', () => {
  it('es un SVG con la inicial y el nombre del producto', () => {
    const svg = placeholderSvg({ name: 'Pizza Hawaiana', tint: 'red' });
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('>P</text>');
    expect(svg).toContain('Pizza Hawaiana');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('escapa los caracteres especiales del nombre', () => {
    const svg = placeholderSvg({ name: 'Mac & <Cheese> "XL"', tint: 'blue' });
    expect(svg).toContain('Mac &amp; &lt;Cheese&gt; &quot;XL&quot;');
    expect(svg).not.toContain('<Cheese>');
  });

  it('un color desconocido no rompe: usa el rojo de la marca', () => {
    expect(placeholderSvg({ name: 'X', tint: 'verde-limon' })).toContain('#dc2626');
  });
});
