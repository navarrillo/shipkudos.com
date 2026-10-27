# ShipClout: plan completo del MVP funcional

Revisión: 27 de octubre de 2026. Este documento sustituye al plan anterior e incorpora los nueve ajustes de infraestructura, CI y despliegue y el registro asistido por agentes mediante API. Define trabajo por implementar; no acredita que existan todavía la aplicación, los scripts o el despliegue.

## 1. Producto y alcance confirmado

- Nombre provisional configurable: **ShipClout**. Web en **inglés**, código público y licencia **MIT**.
- Participación gratuita. Monetización mediante patrocinios vendidos y cobrados manualmente, administrados desde la web.
- Cualquier visitante consulta el ranking y los perfiles inscritos. Para extraer sus estadísticas y crear su perfil, la persona debe conectar GitHub y aceptar expresamente su publicación.
- Recorrido principal: visitar → conectar GitHub → aceptar publicación → sincronizar → aparecer en el ranking → compartir perfil en X.
- Recorrido para agentes: leer la guía pública → iniciar registro por API → completar la autorización con GitHub o entregar el enlace al dueño → consultar el resultado y devolver su perfil público. El agente actúa en representación de la persona; sigue existiendo una única cuenta y posición por ID de GitHub.
- «GitHub verified» acredita el control de la cuenta; las herramientas de IA se declaran por el usuario y se identifican como datos declarados.
- Se mide actividad pública registrada, sin atribuir automáticamente trabajo a la IA ni certificar calidad o productividad.
- Fuera del MVP: repositorios privados, medición de tokens o costes de agentes, ejecución de bots dentro de ShipClout, servidor MCP, perfiles o rankings independientes de agentes, publicación automática en X, pagos online, cuentas de anunciantes, ligas privadas, seguidores, comentarios y otros idiomas. MCP podrá añadirse después sobre los mismos servicios de la API.

### Páginas

| Ruta | Funcionalidad |
| --- | --- |
| `/` | Presentación, primeros participantes, explicación y acceso con GitHub. |
| `/leaderboard` | Ranking de 7 días por defecto o 30 días, búsqueda entre inscritos y páginas de 50 resultados. |
| `/u/[login]` | Perfil, identidad verificada, desglose de actividad, gráfico diario y tarjeta compartible. |
| `/dashboard` | Inscripción, herramientas declaradas, usuario de X no verificado, sincronización, agentes autorizados, revocación de credenciales y retirada o eliminación. |
| `/agents` | Guía en inglés para agentes, ejemplo de instrucción para copiar, flujo de registro, permisos, límites y enlaces a OpenAPI. |
| `/agents/authorize/[registrationId]` | Conexión con GitHub y confirmación del registro o autorización del agente, mostrando la cuenta real y los permisos solicitados. |
| `/advertise` | Oferta comercial, formatos y formulario de contacto. |
| `/admin` | Participantes, cola, contactos comerciales, campañas y métricas. |
| `/methodology` | Fórmula, periodos, actualización, empates y limitaciones. |
| `/privacy`, `/terms` | Explicación de datos, publicación, retirada, eliminación y publicidad. |

Diseño adaptable: grafito, paneles oscuros, acento lima y cian, Geist y Geist Mono autoalojadas; componentes accesibles, navegación por teclado, foco visible y movimiento reducido. Los datos de demostración se limitarán a desarrollo y pruebas.

## 2. Stack acordado y arquitectura

| Componente | Elección |
| --- | --- |
| Web y API | **Next.js 16, App Router, React y TypeScript estricto**. |
| Runtime | **Node.js 24 LTS**. |
| UI | **Tailwind CSS, shadcn/ui y Lucide**. |
| Base de datos | **PostgreSQL 18 propio del proyecto**, en Docker. |
| Datos y migraciones | **Drizzle ORM y `pg`**, con migraciones SQL versionadas. |
| Autenticación | **Better Auth y GitHub App**. |
| Acceso para agentes | **API REST JSON versionada en Next.js**, documentación **OpenAPI** y credenciales delegadas propias de ShipClout. |
| Cola y programación | **pg-boss** y proceso **worker Node.js independiente**. |
| GitHub | **Octokit REST y GraphQL**. |
| Tarjetas sociales | **Next.js ImageResponse**. |
| Validación | **Zod**. |
| Pruebas | **Vitest**, **Playwright** y **k6 manual**. |
| Distribución | **Docker Compose, GitHub Actions y GHCR público**. |
| Proxy | **Caddy existente en el servidor**, con fragmento independiente. |

Un único proyecto y módulos compartidos de datos, autenticación, GitHub y dominio. Una misma imagen de aplicación ejecutará web, worker o migraciones mediante órdenes distintas. Versiones exactas fijadas en manifiesto y lockfile; imágenes base fijadas por versión y digest, sin actualizaciones mayores implícitas.

Tres servicios permanentes: `web`, `worker`, `postgres`. Migraciones, backup y restore serán tareas puntuales. Las consultas de visitantes no realizarán llamadas a GitHub: leerán snapshots y datos guardados, con caché pública.

El registro y la API de agentes se ejecutan en esos mismos servicios. No requieren otro contenedor, conexión con un proveedor de modelos, instalación de un cliente específico ni servidor MCP.

## 3. Identidad, estadísticas y procesamiento

### Identidad y publicación

- Identidad principal exclusivamente mediante OAuth con GitHub; sin contraseñas propias ni vinculación automática por coincidencia de correo. Los agentes acceden mediante credenciales delegadas de ShipClout, emitidas después de esa verificación.
- GitHub App con lectura de correo para Better Auth, acceso implícito a recursos públicos y sin permisos sobre repositorios privados ni instalación obligatoria en repositorios.
- Identidad única por ID estable de GitHub. Cambiar de login no crea otro participante.
- Solo cuentas personales como participantes del ranking; organizaciones y cuentas que GitHub identifica como bots no se inscriben como participantes. Esto no impide que Grok Bot u otro agente registre y gestione el acceso limitado al perfil personal de su dueño.
- Consentimiento de publicación previo a la primera extracción. Nombre, avatar y biografía proceden de GitHub.
- Retirada: ocultar perfil, excluirlo del ranking, detener sincronizaciones e invalidar cachés. Eliminación: además, borrar sesiones, credenciales y datos personales de la base activa.
- Administración limitada a IDs estables de GitHub configurados en el `.env` externo.
- Tokens OAuth cifrados en almacenamiento mediante adaptador compartido; nunca se entregan al navegador ni se registran en logs.
- Renovación de tokens expirables centralizada y bloqueada por cuenta para evitar carreras. Revocación detectada mediante respuesta de GitHub y webhook con firma validada.

### Registro asistido por agentes y acceso delegado

**Decisión:** API REST más una guía pública para agentes desde el MVP. La navegación web será una alternativa para completar la autorización; MCP se pospone. La cuenta clasificada es la de la persona, no una identidad pública adicional del bot.

1. El usuario puede indicar al agente: «Lee las instrucciones de ShipClout y registra mi perfil de GitHub. Si necesitas que autorice algo, pásame el enlace».
2. El agente lee `/agents`, disponible también como texto en `/agents.md`, con referencia desde `/llms.txt` y especificación `/openapi.json`. La guía explica operaciones, ejemplos, errores, sondeo, permisos y cómo completar el flujo por navegador. No depende de que el agente descubra endpoints por intuición ni de una integración exclusiva con Grok.
3. El agente inicia un registro pendiente por API con su nombre descriptivo y plataforma declarada. Recibe `registrationId`, un enlace absoluto `authorizationUrl`, una credencial temporal privada `registrationToken`, vencimiento y un intervalo de consulta de cinco segundos.
4. Si dispone de navegador con sesión de GitHub y autorización del dueño para completar el proceso, el agente puede recorrer el enlace y completar el flujo dentro de los permisos de su entorno. Si necesita inicio de sesión, consentimiento, 2FA u otra intervención, entrega ese mismo enlace al dueño y espera. Tener acceso previo a GitHub no sustituye la autorización de nuestra GitHub App.
5. La página de autorización muestra la cuenta obtenida realmente de GitHub, el nombre y plataforma declarados del agente y sus permisos. El nombre de usuario enviado por el agente nunca sirve como prueba de identidad. Una persona nueva acepta también publicar el perfil; si ya participa, se vincula la autorización a la cuenta existente, sin duplicar perfil, estadísticas o posición.
6. Tras confirmar, el registro queda aprobado. El agente consulta su estado con la credencial temporal y la canjea una sola vez por una credencial propia de ShipClout. Los tokens OAuth y refresh tokens de GitHub permanecen exclusivamente en el backend.
7. Se inicia o reutiliza la sincronización correspondiente. El agente consulta estado, posición y tarjeta, y entrega al usuario su URL pública. No publica en X automáticamente ni envía datos fuera del flujo solicitado.

**Estados:** `pending`, `approved`, `completed`, `rejected` y `expired`. Los registros pendientes y su credencial temporal caducan a los 15 minutos; los registros caducados o rechazados se eliminan en 24 horas. Antes de aprobar no se crea un participante público ni se programa una extracción de GitHub.

**Credenciales delegadas:** secretas, aleatorias, almacenadas mediante hash, mostradas una sola vez al canjear y con caducidad inicial de 90 días. La guía obliga a conservarlas en el almacenamiento privado del agente, nunca en URLs, código, perfiles o mensajes públicos. Si se pierde una credencial, el dueño la revoca y repite la vinculación.

Permisos del MVP, mostrados en la confirmación: `profile:read`, `sync:request` y `share:read`. Permiten consultar el propio perfil y posición, ver el estado de sincronización, solicitar actualización y obtener enlaces y tarjeta. No permiten editar identidad o estadísticas, publicar o eliminar cuentas, administrar anuncios, crear otras credenciales ni acceder a GitHub directamente.

El dashboard muestra agentes autorizados, permisos, caducidad y último uso, y permite revocar cada credencial. Pueden existir varios agentes por persona, pero todos comparten los límites de actualización del mismo participante: una clave adicional no amplía la cuota. El nombre y plataforma del agente son declarados, no una certificación del proveedor.

El registro y el sondeo tienen límites de peticiones y respuestas `429` con `Retry-After`; las credenciales temporales y permanentes se envían por `Authorization: Bearer`, con respuestas `no-store`. Reintentos no duplican participantes ni trabajos. El enlace para el dueño no contiene la credencial temporal del agente; la autorización web exige sesión OAuth y confirmación y mantiene las protecciones de origen y CSRF del flujo de la aplicación.

Retirar o eliminar la cuenta, o revocar su autorización de GitHub, cancela registros pendientes y credenciales delegadas. La primera credencial no se obtiene aportando un PAT o una contraseña de GitHub; se utiliza exclusivamente nuestro recorrido de autorización. La revocación se aplica antes de aceptar nuevas operaciones, sin depender de una caché de credenciales duradera.

### Fórmula y periodos

**Actividad pública = commits contabilizados + PR abiertas + issues abiertas + contribuciones de revisión de PR.**

- Cada componente suma una unidad conforme a los contadores de `ContributionsCollection` obtenidos con permisos limitados a recursos públicos.
- No utilizar el total bruto del calendario cuando pueda incorporar actividad restringida. Prueba obligatoria con una cuenta que tenga contribuciones públicas y privadas.
- Excluir actividad privada o restringida, estrellas, seguidores, líneas de código y creación de repositorios.
- Guardar agregados diarios y sumar los últimos 7 o 30 días naturales UTC, incluido el día actual hasta la última sincronización. Evitar dobles conteos en los límites de medianoche.
- Empates con posición compartida (`1, 1, 3`); orden visual estable por ID de GitHub.
- Solo se clasifica a inscritos visibles con una sincronización correcta en las últimas 48 horas. Los pendientes no aparecen; los desactualizados conservan un perfil marcado con su última fecha, sin posición vigente.
- Mostrar que el ranking corresponde a participantes de ShipClout.
- Desglose por componente, días activos, gráfico de 60 días y racha observada; `60+` si supera el historial disponible.
- Moderación manual con motivo y auditoría; el administrador puede ocultar, pero no modificar las cifras.

### Cola y sincronización

- Primera extracción de 60 días; actualización de últimos 7 días cada 6 horas para participantes con acceso o actividad en los últimos 7 días, y cada 24 horas para el resto.
- Reconciliación completa semanal de los 60 días. Actualización solicitada como máximo una vez por hora por participante, compartida entre dashboard y todas sus credenciales de agente.
- Consultas agrupadas en lotes de hasta diez días. No descargar historiales completos de commits.
- Un worker inicial, dos sincronizaciones concurrentes y máximo de dos peticiones por segundo desde ese proceso; primeras sincronizaciones prioritarias.
- Un único trabajo pendiente o activo de sincronización por participante; operaciones idempotentes.
- Respetar `Retry-After` y reinicio de cuotas; reintentos limitados con espera creciente para errores transitorios. Trabajos fallidos visibles en administración.
- Un error o respuesta parcial no sustituye datos válidos por ceros ni publica un resultado incompleto.
- Recalcular y publicar snapshots cada 15 minutos, mediante sustitución transaccional. Conservar los dos últimos para paginar; un cursor caducado pide reiniciar la consulta.

### Caché, datos y retención

- Ranking público: 60 segundos; perfil público: cinco minutos. Administración, dashboard, autenticación, autorización y API privada de agentes, anuncios y salud fuera de la caché compartida.
- Invalidación expresa al ocultar, retirar o eliminar perfiles, y al cambiar campañas.
- Tablas de Better Auth; participantes; registros pendientes de agentes; credenciales delegadas con hash, propietario, permisos, caducidad y revocación; estadísticas diarias; sincronizaciones; snapshots; histórico diario de posiciones; anunciantes; campañas; creatividades; contactos; eventos y agregados publicitarios; estado operativo del worker.
- Restricciones únicas para ID de GitHub, participante/fecha y deduplicación de eventos.
- Estadísticas detalladas: 60 días; posiciones diarias: 30; eventos publicitarios individuales: 48 horas; agregados: 12 meses; trabajos completados: siete días; fallidos: 30 días.
- Las creatividades tendrán nombres inmutables y publicación mediante escritura temporal y renombrado atómico. La eliminación de campañas será lógica; no habrá borrado físico automático de sus creatividades en el MVP, para mantener referencias y copias coherentes.

## 4. Difusión y monetización

### Compartir

- Perfil público con Open Graph y Twitter Card.
- PNG 1200 × 630: avatar, nombre, periodo, posición, actividad y fecha; generación bajo demanda con caché y concurrencia limitada.
- Botón que abre el compositor de X con texto editable. Sin publicación automática.
- La tarjeta expresa actividad pública y posición entre participantes, sin afirmar uso de IA verificado.

### Publicidad

Dos ubicaciones: patrocinador principal en inicio/ranking y herramienta patrocinada en ranking/perfiles. Una campaña puede contratar ambas; cada espacio admite una campaña activa por intervalo, sin solapamientos.

El panel permite crear anunciantes, texto, URL, imágenes PNG/JPEG/WebP de hasta 1 MB, ubicaciones, fechas, borradores, programación, pausa y finalización. Las fechas se muestran en `Europe/Stockholm` y se guardan en UTC. La entrega comprueba fechas en cada petición, sin depender de un trabajo programado puntual.

Publicidad identificada como «Sponsored», independiente del orden del ranking y sin scripts de terceros suministrados por anunciantes.

- Contactos comerciales: nuevo, en conversación o cerrado; venta y cobro externos a la plataforma.
- Impresión: al menos 50% visible durante un segundo, con identificador firmado y deduplicación.
- Clic: redirección al destino guardado de la campaña; sin destinos arbitrarios aportados en la petición.
- Límites de peticiones y filtrado básico de bots; agregados por campaña, ubicación y día.
- Panel y CSV con impresiones, clics y CTR, identificados como estimaciones. Contratación por duración fija en el MVP.

## 5. Interfaces de aplicación

| Interfaz | Contrato |
| --- | --- |
| `/api/auth/*` | Acceso y sesiones de Better Auth; bloquear endpoints que expongan tokens OAuth al cliente. |
| `GET /api/leaderboard` | `7d` o `30d`, búsqueda y cursor; posiciones, snapshot y siguiente cursor. |
| `GET /api/profiles/[login]` | Solo perfiles publicados y sus estadísticas públicas. |
| `GET /api/me`, `PATCH /api/me` | Estado privado y preferencias editables; identidad no editable. |
| `POST /api/me/publish` | Consentimiento y primera sincronización. |
| `POST /api/me/sync` | Solicitud idempotente; `202` o `429` con próxima disponibilidad. |
| `DELETE /api/me/publication`, `DELETE /api/me` | Retirada y eliminación. |
| `/api/ads`, `/api/ad-events`, `/r/[campaignId]` | Entrega, medición y redirección publicitaria. |
| `POST /api/advertiser-leads` | Formulario comercial validado y limitado. |
| `/api/admin/*` | Gestión comercial y operativa autorizada. |
| `POST /api/github/webhook` | Revocaciones con firma y deduplicación. |
| `/healthz`, `/readyz` | Vida del proceso y salud integral, según la sección 8. |

### API pública versionada para agentes

| Interfaz | Contrato |
| --- | --- |
| `GET /agents`, `GET /agents.md`, `GET /llms.txt`, `GET /openapi.json` | Guía, instrucciones legibles como texto y documentación de las operaciones disponibles. Sin secretos ni datos personales. |
| `POST /api/v1/agent-registrations` | Crear un registro pendiente limitado; devolver identificador, enlace de autorización, credencial temporal, vencimiento e intervalo de sondeo. |
| `GET /api/v1/agent-registrations/[id]` | Consultar el estado usando la credencial temporal del mismo registro; no revela credenciales permanentes. |
| `POST /api/v1/agent-registrations/[id]/exchange` | Canjear una aprobación una sola vez por la credencial delegada, con sus permisos y caducidad. Rechazar registros pendientes, rechazados, caducados o ya consumidos. |
| `GET /api/v1/me` | Perfil y posición del propietario de la credencial, respetando `profile:read`. |
| `GET /api/v1/me/sync` | Estado de sincronización y próxima actualización permitida, respetando `profile:read`. |
| `POST /api/v1/me/sync` | Encolar la actualización idempotente con `sync:request`; `202` o `429` con próxima disponibilidad. |
| `GET /api/v1/me/share?period=7d\|30d` | Texto sugerido, URL pública y URL de tarjeta con `share:read`; sin publicar nada en redes. |
| `GET /api/me/agent-credentials`, `DELETE /api/me/agent-credentials/[id]` | Listar y revocar desde la sesión web del propietario; una credencial delegada no puede invocar estas operaciones. |

Las operaciones delegadas resuelven siempre al participante desde la credencial; no aceptan un ID ajeno para actuar en su nombre. La API reutiliza los mismos servicios de identidad, consultas y sincronización que la web. Secretos incorrectos o revocados: `401`; permiso insuficiente: `403`; estado de registro incompatible o canje ya usado: `409`; límite: `429` con `Retry-After`. Los errores describen qué paso debe hacer el agente, sin exponer información privada.

## 6. CI/CD automático y GHCR

### Matriz de ejecución

| Evento | Lint, typecheck y Vitest | Playwright | Docker | Publicar GHCR | Desplegar | k6 |
| --- | --- | --- | --- | --- | --- | --- |
| PR normal | Sí | No | No | No | No | No |
| PR que cambia infraestructura/despliegue | Sí | Sí | Construir y comprobar | No | No | No |
| Push a `main` | Sí | Sí | Construir y comprobar | Sí | Sí, tras superar comprobaciones | No |
| Tag de versión del commit de `main` | Comprobar procedencia y digest | No repetir | Reutilizar digest publicado | Añadir etiqueta de versión | No repetir | No |
| `workflow_dispatch` de carga | No obligatorio | No | No | No | No | Sí |

- PR normal: un job ligero con caché del gestor de paquetes, instalación congelada y únicamente lint, typecheck y Vitest. Objetivo medido: menos de 60 segundos con caché caliente, excluyendo espera en la cola de runners. No prometer ese tiempo para colas externas o instalaciones frías.
- Detectar cambios en Dockerfiles, archivos Compose, `bin/**`, configuración de despliegue/Caddy y workflows. Un cambio en esos archivos activa las comprobaciones pesadas del PR; el resto no.
- Playwright y pruebas de integración con PostgreSQL se ejecutan en la ruta pesada. k6 se lanza únicamente mediante `workflow_dispatch`, contra la URL elegida, sin ejecutarse por push o PR.
- Todos los jobs usan runners alojados por GitHub; el VPS recibe el despliegue mediante SSH y no ejecuta un runner self-hosted.
- Main se procesa de forma serial desde el inicio del workflow de entrega: grupo de concurrencia de producción con `queue: max`, sin cancelar ejecuciones en curso. Evitar que builds terminados fuera de orden desplieguen commits antiguos después de nuevos.
- CI usa `GITHUB_TOKEN` con permiso de escritura de paquetes solo en publicación. Los PR, incluidos forks, no reciben credenciales de producción ni publican imágenes.
- GHCR público: `ghcr.io/<owner>/shipclout:<sha-completo>`; añadir `vX.Y.Z` a ese mismo digest al versionar. `latest` no participa en despliegue ni rollback.
- El paquete se configura como público en la preparación inicial. Cada publicación comprueba acceso anónimo usando configuración de Docker sin credenciales antes de autorizar el despliegue. Un repositorio público no basta para garantizar la visibilidad del paquete.
- Etiquetas OCI con repositorio y revisión. No sobrescribir una etiqueta SHA con un contenido distinto.
- Actions transfiere los scripts/configuración correspondientes al SHA a un directorio de release y ejecuta `bin/deploy <sha>` por SSH, con host verificado. El `.env` del servidor nunca viaja al runner.

## 7. Contrato de deploy y rollback

Scripts Bash no interactivos entregados en el repositorio. Usarán el mismo fichero de bloqueo externo, con `flock`, y un estado de despliegue fuera del checkout. Ese estado contiene referencias de imágenes, SHA y fases, no secretos ni otra configuración `.env`.

### `bin/deploy <sha>`

1. Validar SHA completo, configuración y disponibilidad de Docker Compose. Adquirir el bloqueo antes de leer o modificar el estado.
2. Identificar la imagen actual validada y conservarla localmente para recuperación.
3. Hacer pull de `ghcr.io/<owner>/shipclout:<sha>` y registrar el digest resuelto; web, worker y migración deben usar esa misma imagen.
4. Ejecutar una única invocación de migración en un contenedor puntual de la nueva imagen: es el único punto que inicializa o actualiza el esquema de aplicación, Better Auth y pg-boss. Desactivar las migraciones automáticas de pg-boss y cualquier otro cambio de esquema al arrancar web/worker. Un bloqueo de base de datos protege la ejecución; los registros de migraciones impiden repetir cambios ya aplicados.
5. Si falla el pull o la migración, dejar los servicios actuales intactos y devolver error.
6. Recrear únicamente `web` y `worker`, sin construir en el VPS y sin recrear PostgreSQL ni borrar volúmenes. No utilizar `compose down` ni `down -v`.
7. Esperar hasta 180 segundos, consultando cada cinco segundos `/readyz`, sin caché, y comprobar que web y worker corresponden al SHA solicitado.
8. Solo tras el éxito registrar atómicamente la versión actual y su predecesora como versiones validadas.
9. Si falla el arranque o la comprobación: recrear únicamente web y worker con la imagen anterior, comprobar su salud y salir con código distinto de cero aunque se recupere correctamente. Nunca revertir migraciones ni restaurar datos como parte del rollback.
10. Conservar diagnóstico y fase para recuperar una ejecución interrumpida. Una versión fallida no se incorpora al historial de versiones válidas.

En el primer despliegue, si no existe imagen anterior, el fallo se comunica y se detienen los servicios nuevos de aplicación, conservando PostgreSQL y sus volúmenes.

### `bin/rollback`

- Adquirir el mismo bloqueo y obtener la versión validada anterior del historial.
- Volver a su imagen para web y worker, sin migrar, reconstruir, restaurar copias o cambiar PostgreSQL.
- Comprobar `/readyz` y las revisiones de los dos procesos. Actualizar el estado solo si se recupera correctamente; salir con error si falta una versión anterior o no queda sano.
- El historial avanza hacia atrás en versiones válidas; no convierte una imagen fallida en candidata de rollback.

Todos los scripts de mantenimiento emplean el mismo bloqueo para evitar solapamientos con deploy/restore. Un segundo proceso espera con timeout acotado y falla sin modificar nada si no obtiene el bloqueo. La recuperación interna no vuelve a adquirir el bloqueo y evita interbloqueos.

Las migraciones y el contrato de arranque/configuración deben ser compatibles con la imagen anterior. Los despliegues normales no incorporan cambios destructivos de esquema ni actualizaciones mayores de PostgreSQL. Los cambios de Compose mantienen esa compatibilidad: rollback sustituye imágenes y no promete deshacer configuración de infraestructura.

## 8. Compose, proxy y salud integral

### Recursos y exposición

| Servicio | Memoria máxima | CPU máxima |
| --- | --- | --- |
| `web` | 768 MiB | 0,75 |
| `worker` | 512 MiB | 0,50 |
| `postgres` | 1.536 MiB | 1 |

- Puerto interno web: `3000`. Publicación exacta: `127.0.0.1:${PORT:-8020}:3000`. Nunca publicar la web en todas las interfaces del host.
- El proceso dentro del contenedor escucha en la interfaz del contenedor para que Docker pueda alcanzarlo; esa escucha interna no cambia el enlace exclusivo a loopback del host.
- PostgreSQL 18 exclusivo del proyecto, volumen propio y sin puerto publicado en el host.
- Parámetros iniciales: `shared_buffers=384MB`, `work_mem=4MB`, `maintenance_work_mem=64MB`, `max_connections=40`; pools de aplicación acotados por debajo de ese máximo. Revisarlos tras medir la carga real.
- Aplicación sin privilegios, reinicio `unless-stopped`, parada ordenada y volúmenes separados para datos, subidas y caché.
- Todos los servicios, incluidas tareas puntuales, con logging Docker `json-file`, `max-size: 10m` y `max-file: 3`, mediante configuración compartida de Compose.
- Sin builds en producción, ni montajes de código fuente o del socket Docker dentro de web/worker.

### `shipclout.caddy`

Entregar un archivo independiente para importar desde la configuración existente. Su bloque de dominio tendrá este comportamiento:

```caddyfile
shipclout.example.com {
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    reverse_proxy 127.0.0.1:8020
}
```

Sustituir únicamente el dominio al instalar. No añadir `includeSubDomains` ni `preload` para otras webs del VPS. El archivo de referencia usa el puerto 8020; si se configura otro `PORT`, actualizar explícitamente su upstream. Caddy será el responsable único de estas cabeceras, sin valores duplicados desde Next.js. Validar la configuración antes de recargar el proxy.

### `/healthz` y `/readyz`

- `/healthz`: indica que el proceso web está vivo; no sustituye la comprobación integral.
- `/readyz`: devuelve `200` solo si PostgreSQL responde dentro de un segundo, existe heartbeat válido del worker de la misma revisión que la web y la cola no está atascada; en cualquier otro caso devuelve `503`.
- Worker: heartbeat cada 30 segundos desde su ciclo operativo; caduca a los 120 segundos. Incluye ID de arranque y revisión de imagen, para no aceptar el latido de un proceso sustituido.
- Cola atascada: existen trabajos vencidos y ejecutables desde hace más de diez minutos, sin finalizaciones ni progreso de ejecución durante ese periodo. Aplicar timeout de ejecución de cinco minutos a las sincronizaciones y a sus peticiones externas.
- Una cola vacía es sana. Trabajos futuros o explícitamente aplazados hasta el reinicio de cuota de GitHub no cuentan como atasco. Un historial de fallos terminales aislados no hace caer la salud del servicio completo.
- Publicar un estado operativo compacto en PostgreSQL y consultarlo mediante índices, sin recorrer toda la cola en cada petición.
- Respuesta JSON mínima con estado general, revisión de web/worker y motivos normalizados por comprobación; sin credenciales, consultas SQL ni errores internos. Siempre `Cache-Control: no-store`.
- Durante el arranque se devuelve `503` hasta que haya señal válida del nuevo worker; el script de despliegue espera, en vez de declarar artificialmente un estado sano.
- Docker Compose no trata el fallo de readiness como motivo automático para reiniciar toda la pila. La reversión automática forma parte del despliegue; una avería posterior se detecta por el chequeo, sin bucles de rollback permanentes.

## 9. Backup, restore, configuración y commits

### `bin/backup`

- Comando no interactivo que usa el `.env` externo y el mismo bloqueo de mantenimiento.
- Escribe en `BACKUP_DIR`, un directorio local configurable fuera del repositorio y de los volúmenes de PostgreSQL.
- Crea un directorio temporal por ejecución con `pg_dump` PostgreSQL 18 en formato custom comprimido (`-Fc`), archivo comprimido de creatividades y manifiesto con fecha UTC, versión, SHA y sumas SHA-256.
- Ejecutar primero el dump y después copiar las creatividades inmutables. Las nuevas subidas pueden aportar archivos adicionales al archivo, pero no faltar referencias ya presentes en el dump; no hay borrado físico concurrente de creatividades en el MVP.
- Publicar la copia mediante renombrado atómico únicamente cuando todo termine y pase las comprobaciones. Un fallo deja error y no una copia marcada como completa.
- No incluir `.env`, secretos ni las imágenes sociales regenerables. No configurar Restic, cifrado, subida externa, retención externa ni un programador adicional: los gestiona el servidor.

### `bin/restore <backup>`

- No interactivo: validar manifiesto, sumas, contenido y rutas antes de tocar el servicio; adquirir el mismo bloqueo.
- Verificar que se dispone de la imagen compatible indicada y del `.env` externo con sus claves originales.
- Detener web y worker, conservar PostgreSQL y restaurar dump y creatividades. Restaurar en el destino configurado; no manipular volúmenes de otras webs.
- Reiniciar la aplicación con la versión del backup y reinicializar el estado efímero del worker; reanudar trabajos interrumpidos conforme a pg-boss y la idempotencia de la aplicación.
- Comprobar `/readyz` y salir con error si la restauración o la recuperación falla. No arrancar la aplicación sobre una restauración incompleta.
- Probar recuperación completa en un entorno aislado. Restore es una operación explícita de recuperación, nunca una fase implícita de deploy/rollback.

### Configuración y secretos

- Un único `.env` real fuera del repositorio, por ejemplo `/etc/shipclout/.env`, con permisos restrictivos. Scripts lo localizan mediante `ENV_FILE`; no crean copias dentro del checkout.
- `.env.example` versionado con nombres, comentarios y valores de ejemplo no sensibles; sin contraseñas, tokens, claves ni correos personales reales.
- Configuración de aplicación, PostgreSQL, OAuth, cifrado de tokens, webhook, IDs administrativos, dominio, rutas, puerto y umbrales de salud en ese archivo.
- Pasar a cada servicio únicamente sus variables necesarias, aunque procedan de la misma fuente.
- Excepción de transporte imprescindible para CI/CD: clave SSH del runner en GitHub Actions Secrets y `GITHUB_TOKEN` efímero para publicar; se inyectan como entorno del workflow. Ningún secreto de aplicación se copia a Actions, al contexto Docker o a GHCR.
- Estado de releases y logs fuera del repo, sin secretos. `.gitignore` y `.dockerignore` excluyen configuraciones reales, copias y datos.

### Identidad de commits

- Todos los commits creados durante este trabajo usarán el correo GitHub noreply real de la cuenta correspondiente, confirmado desde GitHub; nunca un correo personal ni un noreply inventado.
- Configurar autor y committer antes de crear commits; verificar ambos campos antes del push.
- No reescribir historial existente como parte de este ajuste ni asumir una dirección noreply hasta confirmar la identidad.

## 10. Desarrollo, pruebas y aceptación

### Secuencia de implementación

1. Base del proyecto, esquema, Compose, configuración, CI ligero y pruebas de contratos de scripts.
2. GitHub App, acceso, consentimiento, renovación y extracción pública real; registro asistido por agentes, canje de credenciales y revocación desde el dashboard.
3. Worker, heartbeat, salud de cola, agregados, ranking y dashboard.
4. Páginas, diseño accesible y tarjetas para compartir; guía de agentes y especificación OpenAPI versionadas junto con la implementación.
5. Contactos comerciales, campañas, creatividades y medición.
6. Imagen pública, pipeline automático, deploy/rollback, backup/restore y documentación operativa.

### Verificación ligera por PR normal

- Lint, typecheck y Vitest, sin contenedores, navegadores ni servicios externos.
- Tests de fórmula, días UTC, empates, deduplicación, elegibilidad, campañas, permisos y evaluación de salud con dobles de datos.
- Agentes: estados y caducidad del registro, canje único, hash y expiración de credenciales, permisos, revocación, acceso al propietario correcto, intervalos de sondeo y cuota compartida entre claves; sin conectarse a GitHub o a proveedores de agentes.
- Tests Vitest que ejecutan scripts contra dobles de `docker`, `curl` y comandos del sistema: fallos de pull/migración/readiness, rollback de solo imágenes, una invocación de migración y exclusión mutua. La suite no requiere Docker.
- Medir duración del job y optimizar caché/suite si supera el objetivo en un PR normal; no reducir cobertura funcional para aparentar cumplimiento.

### Verificación pesada en main y PR de infraestructura

- Playwright y PostgreSQL efímero en runners de GitHub; recorrido completo hasta perfil y tarjeta, administración, publicidad y retirada.
- Registro asistido completo con cliente HTTP y OAuth simulado: agente inicia, dueño autoriza mediante enlace, agente canjea y consulta; repetir con participante existente sin duplicar cuenta, con cancelación y con revocación. Cubrir también el recorrido por navegador con una sesión previa.
- Verificar que el enlace para el dueño no permite obtener la credencial del agente, que ningún endpoint entrega tokens GitHub y que la credencial no permite modificar perfiles, anuncios, cuentas ni registros ajenos.
- Construcción de imagen, revisión de Compose, fragmento de Caddy y arranque real de web/worker/PostgreSQL.
- `/readyz`: DB inaccesible, worker parado, heartbeat viejo, revisión equivocada, cola sin progreso, cola vacía y espera legítima por cuota.
- Deploy: dos ejecuciones concurrentes; migración fallida sin cambiar servicios; imagen nueva defectuosa con recuperación de anterior y salida de error; worker incorrecto no aceptado; primer despliegue fallido sin borrar datos.
- Verificar que rollback no cambia esquema, datos, PostgreSQL ni volúmenes, y que no ejecuta migraciones.
- Backup/restore reales en proyecto Compose aislado: comprobar datos, imagen, creatividades, sumas, fallo de copia y recuperación saludable.
- Verificar acceso anónimo al paquete antes de desplegar, enlace exclusivo a loopback y rotación de logs en todos los servicios.
- Secretos nunca en imagen, logs o archivos versionados; emails noreply en autor/committer de los commits generados.
- Antes de abrir al público: prueba real de OAuth con GitHub, renovación y cuenta con contribuciones privadas. Las pruebas normales de CI usarán dobles, sin credenciales de usuarios reales.
- Antes de anunciar compatibilidad con Grok Bot: ensayo manual leyendo la guía pública y completando el registro, tanto con sesión de GitHub disponible como entregando el enlace al dueño cuando se necesite. Sin dependencias de Grok ni llamadas a modelos en CI.

### Carga manual

Workflow k6 únicamente `workflow_dispatch`, sin disparadores automáticos. Fixture de 10.000 participantes y 60 días de estadísticas. Lectura cacheada: 50 solicitudes/s durante diez minutos y pico de 200 durante un minuto; objetivo menos del 1% de errores y p95 inferior a 500 ms en entorno equivalente y aislado. Probar también cola con 100 altas simuladas, conservando límites de GitHub y recursos.

El resultado valida una capacidad concreta, no una promesa de tráfico ilimitado. No ejecutar carga contra otras webs del VPS ni automáticamente durante un despliegue.

### Condiciones de finalización

- Una persona conecta GitHub, acepta publicar, obtiene datos públicos correctos, aparece en ambos rankings y comparte su perfil.
- Un agente puede seguir la guía, iniciar el alta de su dueño, completar o delegar la autorización mediante enlace, consultar la sincronización y devolver perfil y tarjeta. El dueño puede revocar su credencial desde el dashboard; no se crea una posición adicional para el agente.
- El administrador programa una campaña, recibe contactos y consulta resultados.
- Cada push validado a main produce una imagen pública por SHA y un despliegue automático; un fallo de la nueva aplicación recupera solo la imagen anterior y marca la ejecución como fallida.
- Un único `/readyz` comprueba base de datos, worker y progreso de cola.
- Los comandos no interactivos de deploy, rollback, backup y restore están documentados y probados.
- Preparación inicial documentada: DNS, importación Caddy, `.env` externo, GitHub App, GHCR público y acceso SSH de Actions. Después, los despliegues ordinarios no requieren bots ni intervención manual.

## Fuentes técnicas de referencia

- Next.js, alojamiento propio: https://nextjs.org/docs/app/guides/self-hosting
- pg-boss: https://github.com/timgit/pg-boss
- Better Auth y GitHub: https://better-auth.com/docs/authentication/github
- GitHub GraphQL y contribuciones: https://docs.github.com/en/graphql/reference/users
- Límites GitHub: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- GHCR, visibilidad inicial privada y acceso público anónimo: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Cola de concurrencia de Actions: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- PostgreSQL 18, memoria: https://www.postgresql.org/docs/18/runtime-config-resource.html
- Caddy, cabeceras: https://caddyserver.com/docs/caddyfile/directives/header
