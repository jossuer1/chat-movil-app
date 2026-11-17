import { validarFoto, validarPerfil } from './profiles.service';

describe('Profile validation', () => {
  const datos = { nombre: ' Ana ', apellido: ' Pérez ', usuario: ' ANA_23 ', ciudad: ' Quito ' };
  it('normalizes a stable username and trims personal details', () => {
    expect(validarPerfil(datos)).toEqual({
      nombre: 'Ana',
      apellido: 'Pérez',
      usuario: 'ana_23',
      ciudad: 'Quito',
      foto_path: null,
    });
  });
  it('rejects empty fields and invalid usernames', () => {
    expect(() => validarPerfil({ ...datos, apellido: ' ' })).toThrow();
    for (const usuario of ['ab', 'ana pérez', 'a'.repeat(25), '../ana'])
      expect(() => validarPerfil({ ...datos, usuario })).toThrow();
  });
  it('rejects SVG and oversized photo uploads', () => {
    expect(() => validarFoto(new File(['<svg/>'], 'avatar.svg', { type: 'image/svg+xml' }))).toThrow();
    expect(() => validarFoto(new File([new Uint8Array(3145729)], 'avatar.png', { type: 'image/png' }))).toThrow();
    expect(() => validarFoto(new File(['jpeg'], 'avatar.jpg', { type: 'image/jpeg' }))).not.toThrow();
  });
});
