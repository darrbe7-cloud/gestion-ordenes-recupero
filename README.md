# Gestión Órdenes Recupero — Web App (Node.js + PostgreSQL)

Versión standalone (no depende de Google ni de Microsoft). Corre en cualquier
hosting que soporte Node.js; estas instrucciones usan **Render** (tiene plan
gratuito, sin tarjeta de crédito).

## Qué hace

Exactamente lo mismo que la versión anterior:
- El administrador sube el .xlsx y lo procesa — la base se reemplaza por completo.
- Filtro automático: `STATUS_ORDEN = P`, `ORIGEN` = MOROSIDAD o SERVICIO DE BAJA, `STATUS_AB = X`.
- El admin crea usuarios y asigna (opcional) qué comunas y tipos puede ver cada uno.
- Cada usuario ve solo sus filas permitidas (RUT, NOMBRE, COMUNA, DIRECCIÓN, TIPO) y descarga un Excel con todas las columnas, solo de sus filas.

## ⚠️ Importante sobre el plan gratuito

Elegiste la opción sin costo. Esto significa:
- La base de datos gratuita de Render **se borra automáticamente cada 30 días**.
- Antes de que se cumpla ese plazo, tienes que volver a crear el usuario admin
  y volver a subir el archivo Excel (que de todas formas actualizas seguido).
- Para no tener que recrear todos los usuarios a mano cada vez, usa el botón
  **"Descargar respaldo"** en la pestaña Usuarios (guarda un archivo `.json`)
  y luego **"Restaurar respaldo"** en la base nueva — recupera todos los
  usuarios con sus claves y permisos en un clic.
- Si en algún momento esto se vuelve más importante y quieres evitar ese
  mantenimiento, se puede pasar al plan pagado (~US$13/mes) y desaparece esta
  limitación — avísame cuando quieras dar ese paso.

---

## Instalación (una sola vez)

### 1. Crear una cuenta de GitHub (si no tienes una)

1. Ve a [github.com](https://github.com) → **Sign up** → crea tu cuenta (gratis).

### 2. Subir este proyecto a un repositorio de GitHub

1. En GitHub, botón **+** (arriba a la derecha) → **New repository**.
2. Nombre: `gestion-ordenes-recupero` (o el que quieras). Puede ser privado.
3. Click **Create repository**.
4. En la página del repo recién creado, busca el link **"uploading an existing file"**.
5. Descomprime en tu computador el .zip que te entregué.
6. Arrastra **todos los archivos y carpetas** (incluyendo `public/` y `src/`) a esa página de GitHub.
7. Abajo, click **Commit changes**.

### 3. Desplegar en Render con un clic (Blueprint)

1. Ve a [render.com](https://render.com) → **Get Started** → crea tu cuenta (puedes usar tu cuenta de GitHub para entrar, es más rápido).
2. En el panel de Render, botón **New +** → **Blueprint**.
3. Conecta tu cuenta de GitHub si te lo pide, y selecciona el repositorio que acabas de crear.
4. Render va a detectar el archivo `render.yaml` del proyecto y te va a mostrar
   que va a crear **dos cosas**: un "Web Service" y una base de datos "PostgreSQL" — ambas en plan gratuito.
5. Click **Apply** (o "Create New Resources").
6. Espera unos minutos mientras Render instala y arranca todo (verás logs en pantalla).
7. Cuando el servicio quede en estado **"Live"** (verde), arriba vas a ver una URL tipo `https://gestion-ordenes-recupero.onrender.com` — esa es tu web app.

### 4. Primer ingreso

1. Abre esa URL.
2. Ingresa con:
   - Usuario: `admin`
   - Clave: `CambiarClave123!`
3. Cambia la clave de inmediato con el botón **"Cambiar clave"**.

> Nota: el plan gratuito de Render "duerme" el servicio tras 15 minutos sin
> uso — la primera vez que alguien entra después de estar inactivo, puede
> tardar hasta 1 minuto en cargar. Es normal, no es un error.

---

## Uso diario

### Cargar / actualizar la base

1. Como admin, pestaña **"Cargar archivo"**.
2. Selecciona el .xlsx desde tu computador.
3. Click **"Subir y procesar"**.
4. Verás una barra de progreso — el proceso corre en segundo plano, puedes seguir navegando.

### Crear usuarios

1. Pestaña **"Usuarios"** → **"+ Nuevo usuario"**.
2. Define usuario y clave, marca las comunas y tipos que puede ver (vacío = sin restricción).

### Respaldo de usuarios (recomendado hacerlo seguido, dado el plan gratuito)

- **"Descargar respaldo"**: baja un archivo `.json` con todos los usuarios (incluye contraseñas cifradas, no en texto plano).
- **"Restaurar respaldo"**: sube ese mismo archivo para recrear todos los usuarios de una vez (por ejemplo, después de que la base gratuita se reinicie a los 30 días).

### Ver / exportar datos

- Cada usuario ve su tabla filtrada, con buscador y paginación.
- Botón **"Descargar Excel"**: baja todas las columnas originales, solo de sus filas permitidas.
- El admin tiene su propia pestaña **"Ver datos"** sin restricción, con filtro adicional por tipo.

---

## Notas técnicas

- El archivo se procesa en modo *streaming* (fila por fila), para no saturar
  la memoria del plan gratuito de Render (512 MB) incluso con archivos grandes.
- Las contraseñas se guardan con **bcrypt** (estándar de la industria, más
  robusto que el hash casero que usaba la versión de Apps Script).
- Tope de exportación: 150.000 filas por descarga (ajustable en `src/dataRoutes.js`, variable `EXPORT_ROW_CAP`).
- Si necesitas correr esto en tu propio servidor en vez de Render, solo
  necesitas Node.js 18+ y una base PostgreSQL — configura la variable de
  entorno `DATABASE_URL` y ejecuta `npm install && npm start`.
