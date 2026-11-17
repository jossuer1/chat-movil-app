import type { OnInit, OnDestroy } from '@angular/core';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonInput, IonButton, IonText } from '@ionic/angular';
import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';

import { AuthService } from '../services/auth.services';
import type { DatosPerfil } from '../services/profiles.service';
import { ProfilesService, validarFoto, validarPerfil } from '../services/profiles.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonInput,
    IonButton,
    IonText,
    AvatarComponent,
  ],
})
export class AuthPage implements OnInit, OnDestroy {
  correo = '';
  contrasena = '';
  modo: 'login' | 'registro' = 'login';
  usuario: User | null = null;
  error = '';
  cargando = false;
  verificandoSesion = true;
  perfilCargado = false;
  nombre = '';
  apellido = '';
  alias = '';
  ciudad = '';
  foto: File | null = null;
  fotoUrl: string | null = null;
  fotoPath: string | null = null;
  private preview: string | null = null;
  private cancelarObservador?: () => void;
  private destruido = false;
  private readonly authService = inject(AuthService);
  private readonly profilesService = inject(ProfilesService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly editar = this.route.snapshot.data['editProfile'] === true;

  ngOnInit(): void {
    this.cancelarObservador = this.authService.observar((usuario) => {
      const anterior = this.usuario?.uid;
      this.usuario = usuario;
      // El registro guarda el formulario antes de permitir que el observador cargue el perfil.
      if (this.cargando) return;
      if (anterior !== usuario?.uid) {
        this.nombre = this.apellido = this.alias = this.ciudad = '';
        this.foto = null;
        this.fotoPath = this.fotoUrl = null;
        this.liberarPreview();
      }
      if (usuario) void this.cargarPerfil();
      else {
        this.verificandoSesion = false;
        this.perfilCargado = false;
      }
      this.changeDetector.markForCheck();
    });
  }
  ionViewWillEnter(): void {
    if (this.usuario && !this.verificandoSesion && !this.cargando) void this.cargarPerfil();
  }
  ngOnDestroy(): void {
    this.destruido = true;
    this.cancelarObservador?.();
    this.liberarPreview();
  }
  async cargarPerfil(): Promise<void> {
    const uid = this.usuario?.uid;
    this.verificandoSesion = true;
    this.perfilCargado = false;
    this.error = '';
    try {
      const perfil = await this.profilesService.obtenerMiPerfil();
      if (this.destruido || this.usuario?.uid !== uid) return;
      this.perfilCargado = true;
      if (perfil && !this.editar) {
        await this.router.navigateByUrl('/home', { replaceUrl: true });
        return;
      }
      if (perfil) {
        this.nombre = perfil.nombre;
        this.apellido = perfil.apellido ?? '';
        this.alias = perfil.usuario ?? '';
        this.ciudad = perfil.ciudad ?? '';
        this.fotoPath = perfil.foto_path ?? null;
        this.fotoUrl = perfil.foto_url ?? null;
      }
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.verificandoSesion = false;
      this.changeDetector.markForCheck();
    }
  }
  cambiarModo(): void {
    if (this.cargando) return;
    this.modo = this.modo === 'login' ? 'registro' : 'login';
    this.error = '';
    this.contrasena = '';
  }
  elegirFoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    try {
      validarFoto(archivo);
      this.liberarPreview();
      this.foto = archivo;
      this.preview = URL.createObjectURL(archivo);
      this.fotoUrl = this.preview;
      this.error = '';
    } catch (error) {
      this.mostrarError(error);
    }
  }
  private datos(): DatosPerfil {
    return validarPerfil({
      nombre: this.nombre,
      apellido: this.apellido,
      usuario: this.alias,
      ciudad: this.ciudad,
      foto_path: this.fotoPath,
    });
  }
  async procesar(): Promise<void> {
    if (this.cargando) return;
    this.error = '';
    try {
      if (!this.correo.trim() || !this.contrasena) throw new Error('Completa correo y contraseña');
      if (this.modo === 'registro') {
        this.datos();
        if (this.contrasena.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      }
      this.cargando = true;
      const credencial =
        this.modo === 'registro'
          ? await this.authService.registrar(this.correo.trim(), this.contrasena)
          : await this.authService.ingresar(this.correo.trim(), this.contrasena);
      this.usuario = credencial.user;
      this.contrasena = '';
      if (this.modo === 'registro') {
        // Si falla Supabase la cuenta sigue iniciada y se ofrece reintentar el perfil.
        this.perfilCargado = true;
        await this.profilesService.guardarPerfil(this.datos(), this.foto);
        await this.router.navigateByUrl('/home', { replaceUrl: true });
      } else {
        await this.cargarPerfil();
      }
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando = false;
      this.verificandoSesion = false;
      this.changeDetector.markForCheck();
    }
  }
  async guardarMiPerfil(): Promise<void> {
    if (this.cargando || !this.perfilCargado || !this.usuario) return;
    this.cargando = true;
    this.error = '';
    try {
      await this.profilesService.guardarPerfil(this.datos(), this.foto);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando = false;
      this.changeDetector.markForCheck();
    }
  }
  async cerrarSesion(): Promise<void> {
    if (this.cargando) return;
    this.cargando = true;
    try {
      await this.authService.salir();
      this.usuario = null;
      this.nombre = this.apellido = this.alias = this.ciudad = this.contrasena = '';
      this.foto = null;
      this.fotoPath = this.fotoUrl = null;
      this.liberarPreview();
      this.modo = 'login';
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando = false;
      this.changeDetector.markForCheck();
    }
  }
  private liberarPreview(): void {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = null;
  }
  private mostrarError(error: unknown): void {
    const mensajes: Record<string, string> = {
      'auth/email-already-in-use': 'Este correo ya está registrado. Inicia sesión para continuar',
      'auth/invalid-email': 'El correo no es válido',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
      'auth/invalid-credential': 'Correo o contraseña incorrectos',
      'auth/wrong-password': 'Correo o contraseña incorrectos',
      'auth/user-not-found': 'Correo o contraseña incorrectos',
      'auth/too-many-requests': 'Demasiados intentos. Inténtalo más tarde',
      'auth/user-disabled': 'La cuenta está deshabilitada',
      'auth/network-request-failed': 'No se pudo conectar con Firebase. Revisa tu conexión',
    };
    this.error =
      error instanceof FirebaseError
        ? (mensajes[error.code] ?? `Firebase rechazó la operación (${error.code})`)
        : error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'No se pudo completar la operación';
  }
}
