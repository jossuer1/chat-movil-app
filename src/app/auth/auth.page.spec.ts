import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { User } from 'firebase/auth';

import { AuthService } from '../services/auth.services';
import { ProfilesService } from '../services/profiles.service';

import { AuthPage } from './auth.page';

describe('AuthPage account flow', () => {
  const user = { uid: 'alice', email: 'alice@example.test' } as User;
  let observer: (user: User | null) => void;
  let auth: {
    observar: ReturnType<typeof vi.fn>;
    registrar: ReturnType<typeof vi.fn>;
    ingresar: ReturnType<typeof vi.fn>;
  };
  let profiles: { obtenerMiPerfil: ReturnType<typeof vi.fn>; guardarPerfil: ReturnType<typeof vi.fn> };
  let page: AuthPage;
  let navigate: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    auth = {
      observar: vi.fn((callback) => {
        observer = callback;
        callback(null);
        return vi.fn();
      }),
      registrar: vi.fn(async () => {
        observer(user);
        return { user };
      }),
      ingresar: vi.fn(async () => {
        observer(user);
        return { user };
      }),
    };
    profiles = {
      obtenerMiPerfil: vi.fn().mockResolvedValue(null),
      guardarPerfil: vi.fn().mockResolvedValue({ firebase_uid: 'alice', nombre: 'Ana' }),
    };
    await TestBed.configureTestingModule({
      imports: [AuthPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ProfilesService, useValue: profiles },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AuthPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    page.correo = 'alice@example.test';
    page.contrasena = 'password123';
  });
  function signup() {
    page.modo = 'registro';
    page.nombre = 'Ana';
    page.apellido = 'Pérez';
    page.alias = 'ana_perez';
    page.ciudad = 'Quito';
  }
  it('validates profile fields before creating a Firebase account', async () => {
    page.modo = 'registro';
    await page.procesar();
    expect(auth.registrar).not.toHaveBeenCalled();
    expect(page.error).toContain('nombre, apellido y ciudad');
  });
  it('stores signup details and enters chat without a second profile form', async () => {
    signup();
    await page.procesar();
    expect(profiles.guardarPerfil).toHaveBeenCalledWith(
      { nombre: 'Ana', apellido: 'Pérez', usuario: 'ana_perez', ciudad: 'Quito', foto_path: null },
      null,
    );
    expect(navigate).toHaveBeenCalledWith('/chats', { replaceUrl: true });
    expect(page.contrasena).toBe('');
  });
  it('reads the selected photo before resetting the picker and saves the prepared bytes', async () => {
    signup();
    const input = { files: [new File(['photo'], 'photo.png', { type: 'image/png' })], value: 'photo.png' };
    const elegir = page.elegirFoto({ target: input } as unknown as Event);
    expect(input.value).toBe('photo.png');
    await page.procesar();
    expect(auth.registrar).not.toHaveBeenCalled();
    await elegir;
    expect(input.value).toBe('');
    expect(page.fotoUrl).toBe('data:image/png;base64,cGhvdG8=');
    await page.procesar();
    expect(profiles.guardarPerfil).toHaveBeenCalledWith(expect.any(Object), {
      mime: 'image/png',
      content: 'cGhvdG8=',
    });
  });
  it('retries a failed profile save without registering a duplicate Firebase account', async () => {
    signup();
    profiles.guardarPerfil.mockRejectedValueOnce(new Error('Usuario ocupado'));
    await page.procesar();
    expect(page.usuario?.uid).toBe('alice');
    expect(page.perfilCargado).toBe(true);
    expect(page.alias).toBe('ana_perez');
    expect(navigate).not.toHaveBeenCalled();
    page.alias = 'ana_perez_2';
    await page.guardarMiPerfil();
    expect(auth.registrar).toHaveBeenCalledOnce();
    expect(profiles.guardarPerfil).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/chats', { replaceUrl: true });
  });
  it('loads an existing profile on login and enters chat without rewriting it', async () => {
    profiles.obtenerMiPerfil.mockResolvedValue({ firebase_uid: 'alice', nombre: 'Nombre existente' });
    await page.procesar();
    expect(navigate).toHaveBeenCalledWith('/chats', { replaceUrl: true });
    expect(profiles.guardarPerfil).not.toHaveBeenCalled();
  });
  it('keeps the profile form available for an authenticated account without a profile', async () => {
    await page.procesar();
    expect(page.perfilCargado).toBe(true);
    expect(page.usuario?.uid).toBe('alice');
    expect(navigate).not.toHaveBeenCalled();
  });
});
