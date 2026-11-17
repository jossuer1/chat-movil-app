import { TestBed } from '@angular/core/testing';
import { ToastController } from '@ionic/angular';

import { ToastService } from './toast.service';

describe('Ionic toast notices', () => {
  it('presents repeated notices and replaces an existing toast', async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn().mockResolvedValue(true);
    const create = vi.fn().mockResolvedValue({ present });
    TestBed.configureTestingModule({
      providers: [{ provide: ToastController, useValue: { create, getTop: vi.fn().mockResolvedValue({ dismiss }) } }],
    });
    const service = TestBed.inject(ToastService);
    await Promise.all([service.mostrar('Tienes un nuevo mensaje'), service.mostrar('Tienes un nuevo mensaje')]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenCalledTimes(2);
    expect(dismiss).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({
      message: 'Tienes un nuevo mensaje',
      position: 'top',
      duration: 5000,
    });
  });
});
