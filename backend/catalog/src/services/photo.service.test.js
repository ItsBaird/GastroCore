import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { JPEG, PNG, WEBP } from '../test/helpers.js';
import {
  MAX_PHOTO_BYTES,
  PHOTOS_URL_PREFIX,
  deletePhoto,
  detectImageType,
  savePhoto,
} from './photo.service.js';

const files = () => (fs.existsSync(env.uploadsDir) ? fs.readdirSync(env.uploadsDir) : []);

beforeEach(() => {
  fs.rmSync(env.uploadsDir, { recursive: true, force: true });
});

describe('constantes', () => {
  it('el limite es de 2 MB y las fotos se sirven bajo /api/catalog/photos/', () => {
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024);
    expect(PHOTOS_URL_PREFIX).toBe('/api/catalog/photos/');
  });
});

describe('detectImageType', () => {
  it('reconoce JPG, PNG y WebP por su firma', () => {
    expect(detectImageType(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectImageType(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectImageType(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('rechaza GIF, texto, vacio y firmas truncadas', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(PNG.subarray(0, 7))).toBeNull();
    expect(detectImageType(WEBP.subarray(0, 11))).toBeNull();
  });

  it('RIFF que no es WEBP (por ejemplo WAV/AVI) no es imagen valida', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    expect(detectImageType(wav)).toBeNull();
  });
});

describe('savePhoto', () => {
  it('crea la carpeta si no existe y guarda el contenido con nombre UUID y la extension detectada', async () => {
    const { filename, url } = await savePhoto(PNG, 'png');
    expect(filename).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    );
    expect(url).toBe(PHOTOS_URL_PREFIX + filename);
    expect(fs.readFileSync(path.join(env.uploadsDir, filename)).equals(PNG)).toBe(true);
  });

  it('cada llamada genera un nombre distinto (no pisa fotos anteriores)', async () => {
    const a = await savePhoto(JPEG, 'jpg');
    const b = await savePhoto(JPEG, 'jpg');
    expect(a.filename).not.toBe(b.filename);
    expect(files()).toHaveLength(2);
  });
});

describe('deletePhoto', () => {
  it('borra el archivo', async () => {
    const { filename } = await savePhoto(JPEG, 'jpg');
    await deletePhoto(filename);
    expect(files()).toEqual([]);
  });

  it('si el archivo ya no existe no lanza error (mejor esfuerzo)', async () => {
    await expect(deletePhoto('no-existe.jpg')).resolves.toBeUndefined();
  });
});
