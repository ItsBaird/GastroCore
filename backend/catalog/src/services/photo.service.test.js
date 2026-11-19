import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JPEG, PNG, WEBP } from '../test/helpers.js';
import { photoStore, storedPhotos } from '../test/photoStore.js';
import {
  MAX_PHOTO_BYTES,
  MIME_BY_EXT,
  PHOTOS_URL_PREFIX,
  deletePhoto,
  detectImageType,
  getPhoto,
  isPhotoFilename,
  savePhoto,
} from './photo.service.js';

vi.mock(
  '../repositories/photo.repository.js',
  async () => (await import('../test/photoStore.js')).photoMock,
);

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/;

beforeEach(() => {
  photoStore.clear();
});

describe('constantes', () => {
  it('el limite es de 2 MB y las fotos se sirven bajo /api/catalog/photos/', () => {
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024);
    expect(PHOTOS_URL_PREFIX).toBe('/api/catalog/photos/');
  });

  it('cada extension guardada tiene su tipo MIME', () => {
    expect(MIME_BY_EXT).toEqual({
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    });
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

  it('un SVG subido NO es una foto valida (solo el seed guarda SVG)', () => {
    expect(
      detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
  });
});

describe('isPhotoFilename', () => {
  it.each([
    '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.jpg',
    '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.png',
    '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.webp',
    'seed-pizza-margarita.svg',
  ])('%s es valido', (name) => {
    expect(isPhotoFilename(name)).toBe(true);
  });

  it.each([
    '../../etc/passwd',
    'vieja.jpg',
    '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.svg', // un UUID nunca es SVG
    '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.gif',
    'seed-Pizza.svg',
    'seed-.svg',
    '',
  ])('"%s" no es valido', (name) => {
    expect(isPhotoFilename(name)).toBe(false);
  });
});

describe('savePhoto', () => {
  it('guarda en la base el contenido con nombre UUID, la extension detectada y su tipo MIME', async () => {
    const { filename, url } = await savePhoto(PNG, 'png');
    expect(filename).toMatch(UUID_NAME);
    expect(url).toBe(PHOTOS_URL_PREFIX + filename);
    const row = photoStore.get(filename);
    expect(row.mimeType).toBe('image/png');
    expect(row.content.equals(PNG)).toBe(true);
  });

  it('cada llamada genera un nombre distinto (no pisa fotos anteriores)', async () => {
    const a = await savePhoto(JPEG, 'jpg');
    const b = await savePhoto(JPEG, 'jpg');
    expect(a.filename).not.toBe(b.filename);
    expect(storedPhotos()).toHaveLength(2);
  });
});

describe('deletePhoto', () => {
  it('borra la foto de la base', async () => {
    const { filename } = await savePhoto(JPEG, 'jpg');
    await deletePhoto(filename);
    expect(storedPhotos()).toEqual([]);
  });

  it('si la foto ya no existe no lanza error (mejor esfuerzo)', async () => {
    await expect(deletePhoto('no-existe.jpg')).resolves.toBeUndefined();
  });

  it('si la base falla tampoco lanza: no debe ocultar el error original', async () => {
    const { photoMock } = await import('../test/photoStore.js');
    const original = photoMock.photoRepository.delete;
    photoMock.photoRepository.delete = async () => {
      throw new Error('db down');
    };
    try {
      await expect(deletePhoto('x.jpg')).resolves.toBeUndefined();
    } finally {
      photoMock.photoRepository.delete = original;
    }
  });
});

describe('getPhoto', () => {
  it('devuelve el tipo y el contenido de una foto guardada', async () => {
    const { filename } = await savePhoto(WEBP, 'webp');
    const photo = await getPhoto(filename);
    expect(photo.mimeType).toBe('image/webp');
    expect(photo.content.equals(WEBP)).toBe(true);
  });

  it('un nombre que no existe -> null', async () => {
    expect(await getPhoto('3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b.jpg')).toBeNull();
  });

  it('un nombre invalido (por ejemplo con ../) -> null, sin consultar la base', async () => {
    const { photoMock } = await import('../test/photoStore.js');
    const spy = vi.spyOn(photoMock.photoRepository, 'findByFilename');
    expect(await getPhoto('../../etc/passwd')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
