import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';

import { auth } from '../firebase.config';

export const authGuard: CanActivateFn = async (_, state) => {
  const router = inject(Router);
  await auth.authStateReady();
  return auth.currentUser ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
