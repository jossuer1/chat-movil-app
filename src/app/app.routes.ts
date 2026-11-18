import type { Routes } from '@angular/router';

import { authGuard } from './auth/auth.guard';
import type { AuthPage } from './auth/auth.page';

const authForm = (): Promise<typeof AuthPage> => import('./auth/auth.page').then((m) => m.AuthPage);

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./welcome/welcome.page').then((m) => m.WelcomePage) },
  { path: 'auth', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', data: { modo: 'login' }, loadComponent: authForm },
  { path: 'register', data: { modo: 'registro' }, loadComponent: authForm },
  {
    path: 'home',
    pathMatch: 'full',
    redirectTo: ({ queryParams }) =>
      typeof queryParams['room'] === 'string' && queryParams['room']
        ? '/room/' + encodeURIComponent(queryParams['room'])
        : '/chats',
  },
  {
    path: 'chats',
    canActivate: [authGuard],
    loadComponent: () => import('./chats/chats.page').then((m) => m.ChatsPage),
  },
  {
    path: 'friends',
    canActivate: [authGuard],
    loadComponent: () => import('./friends/friends.page').then((m) => m.FriendsPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: 'profile', canActivate: [authGuard], data: { editProfile: true }, loadComponent: authForm },
  {
    path: 'room/:id/participants',
    canActivate: [authGuard],
    loadComponent: () => import('./participants/participants.page').then((m) => m.ParticipantsPage),
  },
  {
    path: 'room/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./room/room.page').then((m) => m.RoomPage),
  },
];
