import { expect, test } from '@playwright/test';

test('visits the authentication page from the app root', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator('ion-title')).toHaveText('Chat Dual');
  await expect(page.locator('ion-input[type="email"] input')).toBeVisible();
  await expect(page.locator('ion-input[type="password"] input')).toBeVisible();
});

test('requires Firebase authentication before opening chat rooms', async ({ page }) => {
  await page.goto('/home');
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator('ion-title')).toHaveText('Chat Dual');
});

test('collects personal details once during signup and fits a mobile screen', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  for (const name of ['nombre', 'apellido', 'alias', 'ciudad']) {
    await expect(page.locator(`ion-input[name="${name}"] input`)).toBeVisible();
  }
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('requires a Firebase session before editing a profile', async ({ page }) => {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/auth$/);
});
