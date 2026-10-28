# Cómo trabajar en este repositorio

> Monorepo de kernel compartido entre verticales. Hoy **no hay código**: solo
> documentación de arquitectura y de producto. Este documento explica el flujo
> de trabajo, no la arquitectura.

---

## 1. Antes de tocar nada

Leer, en este orden:

1. [`docs/kernel-context.md`](docs/kernel-context.md) — arquitectura del kernel,
   decisiones `D1`–`D22`, prohibiciones duras.
2. El documento del producto que vas a tocar, por ejemplo
   [`docs/teacher-service-context.md`](docs/teacher-service-context.md) —
   decisiones `T1`–`T25`, modelo de datos, alcance por versión (`F-xx`).

Ambos tienen una sección **§0.1 con un prompt de arranque** para pegar en un chat
nuevo.

**Un chat por feature o micro-cambio.** Nunca dos features en la misma sesión.

---

## 2. Reglas de la rama `main`

Están **aplicadas y verificadas** en GitHub. No son una convención: el servidor
las impone.

| Regla | Efecto |
|---|---|
| PR obligatorio | El push directo se rechaza con `GH006: Changes must be made through a pull request` |
| `enforce_admins` | **Ni el owner** puede pushear directo a `main` |
| Aprobaciones requeridas: 0 | El owner puede mergear su propio PR (GitHub no permite auto-aprobarse) |
| Historial lineal | Sin merges enredados |
| Force-push y borrado de `main` | Prohibidos |
| Resolución de conversaciones | Hay que resolver los comentarios antes de mergear |
| **Solo squash merge** | Los métodos *merge commit* y *rebase* están deshabilitados a nivel repo |
| Borrar rama al mergear | Activado |

**El merge lo hace una persona desde la web**, no un agente. Un agente abre el
PR y se detiene ahí.

---

## 3. Flujo

```bash
# 1. Rama nueva desde main actualizado
git checkout main && git pull
git checkout -b feat/f-01-captura-clase

# 2. Trabajo, con commits pequeños
git add -A && git commit -m "feat(teacher): agrega captura de asistencia offline"

# 3. Push de la rama
git push -u origin feat/f-01-captura-clase

# 4. Abrir el PR (web o CLI) y DETENERSE
# 5. Revisar, aprobar y "Squash and merge" desde la web
```

### Nombres de rama

`<tipo>/<alcance>-<descripción-corta>`, en `kebab-case`:

| Tipo | Uso | Ejemplo |
|---|---|---|
| `feat/` | feature nueva | `feat/f-02-calificaciones-offline` |
| `fix/` | corrección | `fix/sync-duplicados-replay` |
| `docs/` | solo documentación | `docs/contrato-idempotencia` |
| `chore/` | tooling, deps, CI | `chore/workspace-pnpm` |
| `refactor/` | sin cambio de comportamiento | `refactor/kernel-scope-als` |

Si la rama corresponde a un feature del documento de producto, **incluir su ID**
(`f-01`, `f-02`, …).

### Commits

- **Conventional Commits**, con el alcance del producto o paquete:
  `feat(teacher): …`, `fix(kernel-http): …`, `docs(kernel): …`
- **Mensajes en español.** El código y los identificadores, en inglés.
- Un commit por unidad de trabajo revisable, no por tipo de archivo.
- No mezclar un refactor con una feature en el mismo commit.

El squash del PR toma el **título y el cuerpo del PR**, así que el título del PR
es el que queda en `main`. Escribilo en consecuencia.

---

## 4. Convenciones de idioma

| Qué | Idioma |
|---|---|
| Nombres de archivos y carpetas | inglés, ASCII, `kebab-case` |
| Código e identificadores | inglés |
| Comentarios de código | inglés |
| Documentación (`docs/`, este archivo) | español |
| Mensajes de commit y títulos de PR | español |
| Textos de interfaz | español (i18n: `es`, `en`, `pt`) |

Sin tildes, `ñ` ni espacios en nombres de archivo.

---

## 5. Estructura del repositorio

```
app-factory/
├── CONTRIBUTING.md           # este archivo
├── docs/
│   ├── kernel-context.md     # arquitectura del kernel
│   └── teacher-service-context.md
├── packages/                 # kernel (a crear)
├── apps/                     # verticales (a crear)
└── tools/                    # create-vertical (implementado)
```

---

## 6. Antes de abrir un PR

- [ ] El cambio pertenece a **una sola** feature o micro-cambio.
- [ ] Leí `docs/kernel-context.md` §6 (prohibiciones duras) y no las violé.
- [ ] Si toqué el modelo de datos de un producto, **paré y propuse un ADR**
      antes de escribir código.
- [ ] Si el cambio contradice una decisión `D*` o `T*`, lo señalé en el PR en
      lugar de implementarlo en silencio.
- [ ] **Escribí los tests antes o junto con el código** (§8). Cubren bordes y
      rutas críticas, no solo el camino feliz.
- [ ] **Revisé la UI en viewport móvil de 375 px** (§9). Si no la vi en un
      teléfono, no está revisada.
- [ ] El documento de producto quedó actualizado si cambió el alcance.
- [ ] El título del PR es un buen mensaje de commit (es el que va a `main`).

---

## 7. Prohibiciones de proceso

- **No** commitear directo a `main` (además, el servidor lo rechaza).
- **No** mergear desde un agente: el merge lo hace una persona desde la web.
- **No** abrir un PR con dos features.
- **No** re-litigar decisiones cerradas sin evidencia nueva. Si tenés evidencia,
  se discute en un issue antes del PR.
- **No** crear paquetes o carpetas "por si acaso". El kernel satisface la
  **intersección** de las verticales, nunca la unión.

---

## 8. Testing and Quality — TDD obligatorio

**Toda implementación se hace con tests.** No se acepta código sin test que lo
cubra. Es la decisión `T25` del producto y la `D22` del kernel.

### 8.1 El ciclo

1. **Escribí el test que falla** (rojo). Describe el comportamiento esperado
   antes de escribirlo.
2. **Implementá lo mínimo para que pase** (verde). Nada más.
3. **Refactorizá** con el test como red de seguridad.

Un test escrito *después* del código no es TDD: es cobertura retroactiva. Sirve,
pero no previene el diseño incorrecto.

### 8.2 Qué se exige cubrir

No se exige 100% de líneas. Se exige **bordes y rutas críticas**:

| Categoría | Ejemplos |
|---|---|
| **Errores de red** | timeout, conexión caída a mitad del envío, respuesta truncada |
| **Reintentos y duplicados** | replay de una request ya aplicada; doble tap en "guardar" |
| **Estados vacíos** | curso sin alumnos, período sin notas, listado en cero |
| **Permisos denegados** | acceso a un curso ajeno, token vencido, rol insuficiente |
| **Límites** | nota en 1 y en 10, nota fuera de rango, fecha de cierre de período |
| **Concurrencia** | dos pestañas escribiendo el mismo registro; sync simultáneo |

**El camino feliz no cuenta como cobertura.** Un test que solo verifica que
guardar funciona no prueba nada: prueba que el código corre.

### 8.3 Dónde vive cada test

| Nivel | Qué prueba | Herramienta |
|---|---|---|
| **Dominio** | invariantes y reglas de negocio de la vertical | unit tests, sin base de datos ni HTTP |
| **Infraestructura** | sync, idempotencia, alcance | `kernel-conformance` |
| **Borde** | endpoints, validación, envelope | `fastify.inject()`, sin contenedor |
| **E2E** | flujo offline → reconexión → convergencia | Playwright o equivalente |

### 8.4 Regla de bloqueo

El CI **bloquea el merge** si:
- algún test falla;
- baja la cobertura de las rutas críticas respecto de `main`.

Un PR sin tests no se aprueba. Si el cambio no admite tests automatizados, se
justifica en el PR y se documenta cómo se verificó manualmente.

---

## 9. Mobile-First Design — regla de diseño

**Toda interfaz se resuelve primero en el celular.** Es la decisión `T24` del
producto y la `D22` del kernel. El escritorio es una adaptación, no el punto de
partida.

| Regla | Detalle |
|---|---|
| **Viewport base** | 375 px. Si no funciona ahí, no funciona |
| **Targets de toque** | 44 px mínimo. Nada depende de `hover` |
| **Tailwind v4+** | Configuración única en `kernel-ui`. Sin CSS ad-hoc ni design systems ajenos |
| **PWA instalable** | Manifiesto, service worker y caché de assets. Instalable en Android e iOS |
| **Carga por teclado** | Teclado numérico en móvil; teclado físico en escritorio. Mismo flujo, distinto input |
| **Peso** | La app se usa con datos móviles. Presupuesto de bundle acordado por vertical |

Un PR de UI se revisa en viewport móvil **antes** de aprobarse. Si el revisor no
lo vio en un teléfono, no está revisado.

### 9.1 Offline es parte del diseño, no un extra

Si la pantalla no funciona sin conexión y su flujo es de captura en aula o en
mostrador, está mal diseñada. El estado offline se diseña junto con el estado
online, no después.
