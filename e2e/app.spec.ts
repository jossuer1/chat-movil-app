import { expect, test } from '@playwright/test';

test('opens login from the welcome screen and can return', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chat Dual' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Iniciar sesión' })
    .or(page.getByRole('link', { name: 'Iniciar sesión' }))
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('ion-input[type="email"] input')).toBeVisible();
  await expect(page.locator('ion-input[name="contrasena"] input')).toBeVisible();
  await expect(page.locator('ion-input[name="contrasena"] input')).toHaveAttribute('type', 'password');
  await page.getByRole('link', { name: 'Inicio' }).click();
  await expect(page.getByRole('heading', { name: 'Chat Dual' })).toBeVisible();
});

test('requires Firebase authentication before opening chat rooms', async ({ page }) => {
  await page.goto('/home?room=sample-room');
  await expect(page).toHaveURL(/\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/room/sample-room');
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
});

test('collects personal details once during signup and fits a mobile screen', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  for (const name of ['nombre', 'apellido', 'alias', 'ciudad']) {
    await expect(page.locator(`ion-input[name="${name}"] input`)).toBeVisible();
  }
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('requires a Firebase session before editing a profile', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?returnUrl=/);
});

test('shows and hides the password without changing it or submitting the login', async ({ page }) => {
  await page.goto('/login');
  const password = page.locator('app-auth:not(.ion-page-hidden) ion-input[name="contrasena"] input:not(.cloned-input)');
  await password.fill('ClaveDePrueba123');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('ClaveDePrueba123');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('ClaveDePrueba123');
  await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  const registrationPassword = page.locator(
    'ion-input[name="contrasena"] input[autocomplete="new-password"]:not(.cloned-input)',
  );
  await expect(registrationPassword).toHaveAttribute('type', 'password');
  await expect(registrationPassword).toHaveValue('');
});
