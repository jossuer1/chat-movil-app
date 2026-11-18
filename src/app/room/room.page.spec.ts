import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertController } from '@ionic/angular';

import { ChatSessionService } from '../services/chat-session.service';
import { ChatService } from '../services/chat.service';
import { LocationService } from '../services/location.service';
import { ToastService } from '../services/toast.service';

import { RoomPage } from './room.page';

describe('RoomPage sending', () => {
  let component: RoomPage;
  let enviar: ReturnType<typeof vi.fn>;
  let guardarUbicacion: ReturnType<typeof vi.fn>;
  let obtener: ReturnType<typeof vi.fn>;
  let decision: string;
  let createAlert: ReturnType<typeof vi.fn>;
  let mostrar: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    decision = 'confirm';
    enviar = vi.fn();
    guardarUbicacion = vi.fn().mockResolvedValue({});
    obtener = vi.fn().mockResolvedValue({ coords: { latitude: -0.18, longitude: -78.46, accuracy: 25 } });
    mostrar = vi.fn().mockResolvedValue(undefined);
    createAlert = vi
      .fn()
      .mockImplementation(async () => ({ present: vi.fn(), onDidDismiss: async () => ({ role: decision }) }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ChatService, useValue: { enviar, guardarUbicacion } },
        {
          provide: ChatSessionService,
          useValue: { uid: signal(''), perfil: signal(null), salasVisibles: signal([]), cargando: signal(false) },
        },
        { provide: LocationService, useValue: { obtener } },
        { provide: ToastService, useValue: { mostrar } },
        { provide: AlertController, useValue: { create: createAlert } },
      ],
    });
    const fixture = TestBed.createComponent(RoomPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.uid.set('alice');
    component.perfil.set({ firebase_uid: 'alice', nombre: 'Alicia' });
    component.salaId.set('sala');
  });
  it('reuses the message identifier after a failed response', async () => {
    enviar.mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValueOnce(undefined);
    component.texto = 'Hola';
    await component.enviar();
    const id = enviar.mock.calls[0][1];
    expect(component.texto).toBe('Hola');
    await component.enviar();
    expect(enviar.mock.calls[1][1]).toBe(id);
    expect(component.texto).toBe('');
  });
  it('does not store or send a location before the confirmation is accepted', async () => {
    let resolveDecision!: (value: { role: string }) => void;
    createAlert.mockResolvedValue({
      present: vi.fn(),
      onDidDismiss: () =>
        new Promise((resolve) => {
          resolveDecision = resolve;
        }),
    });
    component.texto = 'Borrador';
    const pending = component.enviar(true);
    await vi.waitFor(() => expect(createAlert).toHaveBeenCalledOnce());
    expect(guardarUbicacion).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    resolveDecision({ role: 'cancel' });
    await pending;
    expect(guardarUbicacion).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(component.texto).toBe('Borrador');
    expect(createAlert.mock.calls[0][0].message).toContain('-0.180000');
  });
  it('stores then sends the confirmed point and shows an Ionic success toast', async () => {
    await component.enviar(true);
    const id = guardarUbicacion.mock.calls[0][1];
    expect(guardarUbicacion).toHaveBeenCalledWith('sala', id, -0.18, -78.46);
    expect(enviar).toHaveBeenCalledWith('sala', id, 'Alicia', '', null, { id, latitude: -0.18, longitude: -78.46 });
    expect(mostrar).toHaveBeenCalledWith('Ubicación enviada', 'success');
  });
  it('keeps the same confirmed point and message ID when retrying a lost send response', async () => {
    enviar.mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValueOnce(undefined);
    await component.enviar(true);
    const id = enviar.mock.calls[0][1];
    await component.enviar(true);
    expect(obtener).toHaveBeenCalledOnce();
    expect(enviar.mock.calls[1][1]).toBe(id);
    expect(createAlert).toHaveBeenCalledTimes(2);
  });
  it('reports denied geolocation without writing anything', async () => {
    obtener.mockRejectedValue(new Error('Ubicación bloqueada'));
    await component.enviar(true);
    expect(createAlert).not.toHaveBeenCalled();
    expect(guardarUbicacion).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(mostrar).toHaveBeenCalledWith('Ubicación bloqueada', 'danger');
    expect(component.ubicando()).toBe(false);
  });
  it('does not send after the session or room changes while confirming', async () => {
    createAlert.mockImplementation(async () => ({
      present: async () => {
        component.salaId.set('otra');
      },
      onDidDismiss: async () => ({ role: 'confirm' }),
    }));
    await component.enviar(true);
    expect(guardarUbicacion).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });
});
