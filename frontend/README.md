# Frontend (React + Vite)

SPA de GastroCore. Stack: React 19, Vite, React Router, Lucide Icons e Inter (tipografía autoalojada).
Los estilos salen del Design System (`src/styles/tokens.css`, colores tomados de los mockups).

## Cómo correrlo en local

Con el backend levantado (`docker compose up -d` en la raíz, y el admin creado con `docker compose exec auth npm run seed:admin`):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Vite reenvía `/api` al gateway (`http://localhost`), así que frontend y API comparten origen: no hay CORS y la cookie del refresh token (`HttpOnly; Secure; SameSite=Strict`) funciona en `localhost`.

Otros comandos: `npm run build`, `npm run lint` (oxlint) y `npm test` (vitest).

## Estructura

```
src/api/        cliente HTTP (renueva la sesión ante un 401) y llamadas por recurso
src/auth/       sesión en memoria, AuthProvider, useAuth y RequireAuth (guard por rol)
src/components/ Modal, ConfirmDialog, Field, Toast
src/layouts/    AdminLayout: barra lateral (riel de iconos en tablet, barra inferior en mobile)
src/pages/      LoginPage, UsersPage (GC-48), páginas de estado
src/styles/     tokens del Design System y estilos base
```

## Sesión

- El access token vive **solo en memoria** (nunca en `localStorage`). El refresh token va en una cookie `httpOnly` que el JavaScript no puede leer.
- Al abrir o recargar la app se llama en silencio a `POST /api/auth/refresh` para recuperar la sesión.
- **Solo puede haber una renovación a la vez.** El backend cierra todas las sesiones si un refresh token se reutiliza, así que `src/auth/session.js` comparte una promesa entre peticiones y un candado de navegador (Web Locks) entre pestañas.
- Si una petición recibe 401, se renueva la sesión una vez y se reintenta; si la renovación es rechazada, la sesión expira y se vuelve al login.

## Rutas

| Ruta | Acceso |
|---|---|
| `/login` | Público |
| `/admin/usuarios` | Solo ADMIN (gestión de usuarios) |
| `/en-construccion` | Cualquier rol con sesión (mesero y cocinero, hasta que existan sus pantallas) |

Ocultar un botón no es seguridad: el backend vuelve a validar el rol en cada petición.
