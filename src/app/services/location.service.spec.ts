import { TestBed } from '@angular/core/testing';
import { Geolocation } from '@capacitor/geolocation';

import { LocationService } from './location.service';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: { getCurrentPosition: vi.fn() } }));

describe('LocationService web', () => {
  beforeEach(() => {
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'geolocation', { value: {}, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('uses a bounded network location request on web', async () => {
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue({ coords: { latitude: 0, longitude: 0 } } as never);
    expect((await TestBed.inject(LocationService).obtener()).coords.latitude).toBe(0);
    expect(Geolocation.getCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 30000,
    });
  });
  it.each([
    [1, 'Ubicación bloqueada'],
    [2, 'Activa la ubicación'],
    [3, 'a tiempo'],
  ])('explains geolocation error %s', async (code, message) => {
    vi.mocked(Geolocation.getCurrentPosition).mockRejectedValue({ code });
    await expect(TestBed.inject(LocationService).obtener()).rejects.toThrow(String(message));
  });
});
