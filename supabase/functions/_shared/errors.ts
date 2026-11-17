export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new ApiError(400, 'invalid-argument', `Introduce un texto de 1 a ${maximum} caracteres`);
  }
  return value.trim();
}

export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, 'invalid-argument', 'Identificador inválido');
  }
  return value;
}

export function coordinates(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new ApiError(400, 'invalid-argument', 'Coordenadas inválidas');
  }
  return { latitude, longitude };
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid-argument', 'Formato de solicitud inválido');
  }
  return value as Record<string, unknown>;
}
