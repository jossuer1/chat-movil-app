import type { OnInit, OnDestroy } from '@angular/core';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent, IonInput, IonButton, IonText, IonIcon } from '@ionic/angular';
import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, logOutOutline } from 'ionicons/icons';

import { AuthService } from '../services/auth.services';
import type { DatosPerfil, FotoPerfil } from '../services/profiles.service';
import { ProfilesService, prepararFoto, validarPerfil } from '../services/profiles.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent, IonInput, IonButton, IonText, AvatarComponent, IonIcon],
})
export class AuthPage implements OnInit, OnDestroy {
  constructor() {
    addIcons({ eyeOutline, eyeOffOutline, logOutOutline });
  }
  correo = '';
  contrasena = '';
  mostrarContrasena = false;
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
  foto: FotoPerfil | null = null;
  leyendoFoto = false;
  fotoUrl: string | null = null;
  fotoPath: string | null = null;
  private fotoGuardadaUrl: string | null = null;
  private cancelarObservador?: () => void;
  private destruido = false;
  private vistaActiva = true;
  private readonly authService = inject(AuthService);
  private readonly profilesService = inject(ProfilesService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly editar = this.route.snapshot.data['editProfile'] === true;

  ngOnInit(): void {
    this.modo = this.route.snapshot.data['modo'] === 'registro' ? 'registro' : 'login';
    this.observarSesion();
  }

  private observarSesion(): void {
    this.cancelarObservador = this.authService.observar((usuario) => {
      const anterior = this.usuario?.uid;
      this.usuario = usuario;
      // El registro guarda el formulario antes de permitir que el observador cargue el perfil.
      if (this.cargando) return;
      if (anterior !== usuario?.uid) {
        this.nombre = this.apellido = this.alias = this.ciudad = '';
        this.foto = null;
        this.fotoPath = this.fotoUrl = this.fotoGuardadaUrl = null;
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
    this.vistaActiva = true;
    if (!this.cancelarObservador) this.observarSesion();
  }
  ionViewWillLeave(): void {
    this.vistaActiva = false;
    this.cancelarObservador?.();
    this.cancelarObservador = undefined;
    this.contrasena = '';
    this.mostrarContrasena = false;
  }
  ngOnDestroy(): void {
    this.destruido = true;
    this.cancelarObservador?.();
  }
  async cargarPerfil(): Promise<void> {
    const uid = this.usuario?.uid;
    this.verificandoSesion = true;
    this.perfilCargado = false;
    this.error = '';
    try {
      const perfil = await this.profilesService.obtenerMiPerfil();
      if (this.destruido || !this.vistaActiva || this.usuario?.uid !== uid) return;
      this.perfilCargado = true;
      if (perfil && !this.editar) {
        await this.entrar();
        return;
      }
      if (perfil) {
        this.nombre = perfil.nombre;
        this.apellido = perfil.apellido ?? '';
        this.alias = perfil.usuario ?? '';
        this.ciudad = perfil.ciudad ?? '';
        this.fotoPath = perfil.foto_path ?? null;
        this.fotoGuardadaUrl = perfil.foto_url ?? null;
        if (!this.foto) this.fotoUrl = this.fotoGuardadaUrl;
      }
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.verificandoSesion = false;
      this.changeDetector.markForCheck();
    }
  }
  async elegirFoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo || this.leyendoFoto || this.cargando) return;
    const uid = this.usuario?.uid;
    this.leyendoFoto = true;
    const sigueEnPerfil = () => !this.destruido && this.usuario?.uid === uid;
    try {
      const foto = await prepararFoto(archivo);
      if (!sigueEnPerfil()) return;
      this.foto = foto;
      this.fotoUrl = `data:${foto.mime};base64,${foto.content}`;
      this.error = '';
    } catch (error) {
      if (sigueEnPerfil()) this.mostrarError(error);
    } finally {
      input.value = '';
      this.leyendoFoto = false;
      this.changeDetector.markForCheck();
    }
  }
  descartarFotoSeleccionada(): void {
    this.foto = null;
    this.fotoUrl = this.fotoGuardadaUrl;
    this.error = '';
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
    if (this.cargando || this.leyendoFoto) return;
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
      this.mostrarContrasena = false;
      if (this.modo === 'registro') {
        // Si falla Supabase la cuenta sigue iniciada y se ofrece reintentar el perfil.
        this.perfilCargado = true;
        await this.profilesService.guardarPerfil(this.datos(), this.foto);
        await this.entrar();
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
    if (this.cargando || this.leyendoFoto || !this.perfilCargado || !this.usuario) return;
    this.cargando = true;
    this.error = '';
    try {
      await this.profilesService.guardarPerfil(this.datos(), this.foto);
      await this.entrar();
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando = false;
      this.changeDetector.markForCheck();
    }
  }
  async cerrarSesion(): Promise<void> {
    if (this.cargando || this.leyendoFoto) return;
    this.cargando = true;
    try {
      await this.authService.salir();
      this.usuario = null;
      this.nombre = this.apellido = this.alias = this.ciudad = this.contrasena = '';
      this.foto = null;
      this.fotoPath = this.fotoUrl = this.fotoGuardadaUrl = null;
      this.mostrarContrasena = false;
      this.modo = 'login';
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando = false;
      this.changeDetector.markForCheck();
    }
  }
  private entrar(): Promise<boolean> {
    if (!this.vistaActiva || this.destruido) return Promise.resolve(false);
    const destino = this.route.snapshot.queryParamMap.get('returnUrl');
    const sala = destino && /^\/room\/[a-z0-9-]+(?:\/participants)?$/i.test(destino) ? destino : '/chats';
    return this.router.navigateByUrl(this.editar ? '/settings' : sala, { replaceUrl: true });
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
