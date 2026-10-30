# teacher-service — Contexto, alcance y modelo

> Documento de producto. Se apoya en `docs/kernel-context.md` (arquitectura del
> monorepo) y no lo repite. Si el código contradice este documento, gana el
> código y el documento se corrige.

---

## 0. Cómo usar este documento

- **Para humanos**: §1 explica el producto, §2 las decisiones ya cerradas, §4
  el alcance por versión.
- **Para agentes**: §2 es vinculante (no re-litigar) — **T24 (mobile-first/PWA)
  y T25 (TDD) son obligatorias**. §3 es el modelo de datos (cambiarlo exige ADR),
  §7 son prohibiciones duras, §10 es lo único abierto.
- **Un chat por feature o micro-cambio.** Cada chat cita el ID (`F-xx`) y este
  documento. No se trabaja sobre memoria de conversaciones anteriores.

### 0.1 Prompt de arranque para un chat nuevo

> ```
> Estamos en el repo app-factory, producto teacher-service.
>
> Leé completos, en este orden:
>   1. docs/kernel-context.md
>   2. docs/teacher-service-context.md
>
> El feature a trabajar es: F-XX — <nombre>.
>
> Tratá §2 (Decisiones cerradas) y §3 (Modelo de datos) como vinculantes.
> §7 son prohibiciones duras. §10 es lo único abierto a propuesta.
>
> Antes de escribir código: (a) decime qué archivos vas a tocar, (b) si el
> feature necesita cambiar el modelo de datos, (c) qué test prueba que quedó
> hecho.
> ```

---

## 1. El producto

**Cliente: el docente individual. No la escuela.**

Docentes de secundaria en Argentina que hoy administran su materia con Google
Sheets (≈70%) o Excel (≈30%). Trabajan en una o varias escuelas, con cursos que
pueden llamarse igual en distintas escuelas y horarios.

### 1.1 La tesis

Las escuelas tienen sus propios sistemas (provinciales, conservadores, difíciles
de reemplazar). **No competimos con el sistema de la escuela.** Competimos con la
planilla personal del docente.

La app es el **cockpit personal del docente**, y produce **artefactos que la
institución acepta**: la planilla oficial impresa, el informe para el preceptor,
el llamado de atención para el cuaderno de comunicados.

### 1.2 El principio central

> **La planilla no es una tabla. Es una proyección.**

En Sheets el docente guarda el *resultado* y lo mantiene a mano. En la app se
guardan las *causas* (clases, notas, asistencias, matrículas) y el resultado se
calcula. Esto es lo que permite reprogramar un tema, recalcular una trayectoria
o reconstruir la planilla de 2023 sin abrir un archivo.

### 1.3 Criterio de adopción

> Si cargar 30 notas y una asistencia tarda más que en Sheets, no se usa.

Todo feature se juzga contra eso: **velocidad del ritual repetido** y **calidad
del artefacto que la institución acepta**. Lo que no caiga en una de esas dos
categorías es adorno.

---

## 2. Decisiones cerradas

### T1 — El tenant es el docente
Cada docente es una instancia independiente. No hay vista compartida entre
docentes, ni identidad global de alumno entre instancias.

### T2 — La escuela es un atributo, no un tenant
Un docente puede trabajar en varias escuelas. La escuela es un dato del curso.

### T3 — Identidad de curso compuesta
`(escuela, materia, división, año, horario)`. "3°1°" en dos escuelas son dos
cursos distintos y no deben colisionar nunca.

### T4 — El alumno tiene identidad estable dentro del tenant
No es una fila de la planilla. Se identifica por DNI o legajo interno, y
sobrevive al cambio de año y de curso.

### T5 — La matrícula es por año
`Alumno × Año × Curso × Materia → estado`. La deuda (`adeudada`) viaja entre
años y es la base de la tabla de trayectoria.

### T6 — Planilla, boletín y trayectoria son vistas derivadas
Nunca se almacenan como tablas editables. Se calculan desde notas, asistencias,
clases y matrículas.

### T7 — La planilla oficial es el contrato de salida
Se replica la plantilla de la jurisdicción para imprimir y firmar al pie. Las
plantillas son **datos versionados** (layout + mapeo de campos), no código.
Cambiar de provincia o de año no debe requerir un release.

### T8 — Compartir es exportar, no integrar
PDF, Excel o enlace. No hay integración con el sistema provincial ni con Google
Classroom.

### T9 — Acceso público por token
El QR del alumno usa un token opaco, revocable, con vencimiento opcional y
alcance definido. Nunca `WHERE code = ?` sobre un código corto adivinable.

### T10 — Offline-first en la captura
Asistencia, notas y tema del día se cargan sin conexión. Un solo escritor por
tenant ⇒ conflicto = última escritura gana.

### T11 — Cancelar una clase no mueve el tema
Se registra la clase como `cancelada(motivo)` y el cronograma se **recalcula**.
Nunca se edita la fecha a mano.

### T12 — El libro de temas es un artefacto legal
Debe poder emitirse con trazabilidad: qué tema estaba previsto, para qué fecha,
cuándo se dictó realmente y por qué se movió.

### T13 — Importar desde Sheets/Excel es feature de primera clase
El docente ya tiene los datos. Pedirle que los tipee de nuevo es la forma más
rápida de perderlo.

### T14 — `school-service` queda fuera del portafolio
Se descarta como producto: requiere adopción institucional y jerarquía
multi-nivel que ninguna vertical actual necesita. `teacher-service` no depende
de él ni espera integrarse con él. Si alguna vez se construye, será un producto
independiente con su propio modelo.

### T15 — Jurisdicción inicial: Provincia de Buenos Aires
Región inicial: Malvinas Argentinas (Grand Bourg, Polvorines), San Miguel,
José C. Paz y Pilar. La plantilla oficial y el calendario se implementan para
PBA. El modelo admite otras jurisdicciones sin cambios de esquema.

### T16 — Escala 1–10, con umbrales **por instancia**
La escala es numérica entera de 1 a 10, pero el mínimo aprobatorio **no es
único**:

| Instancia | Mínimo | Fuente |
|---|---|---|
| Cuatrimestre (curso regular) | 7 | práctica de la escuela |
| Intensificación | 4 (escala 4–10) | normativa PBA |

Ambos configurables por escuela y por curso. Modelar un solo "mínimo global" es
incorrecto.

### T17 — Valoración cualitativa a mitad de cuatrimestre
TEA / TEP / TED — *Trayectoria Educativa Avanzada / en Proceso / Discontinua*
(Res. 1650/24 DGCyE). Se registra a mediados de cada cuatrimestre (mayo y
octubre) y se comunica a las familias. Al **cierre** del cuatrimestre va nota
numérica, más el registro en el RITE (Registro Institucional de Trayectorias
Educativas).

### T18 — Dos cuatrimestres, con ventanas de intensificación configurables
El ciclo tiene 2 cuatrimestres. Las ventanas de intensificación (al inicio y al
cierre de cada cuatrimestre) **las define cada escuela** según normativa:
una puede intensificar todo noviembre y otra solo las últimas dos semanas.

El **calendario institucional es un dato configurable**, no una constante, y es
insumo del cronograma, de la planificación por fechas y de los avisos.

### T19 — El estudiante solo lee
No hay entregas dentro de la app. El docente carga nota y detalle; el estudiante
consulta resultado, calificaciones y asistencia por su enlace. Las entregas
siguen por Drive, email o papel.

### T20 — Identidad: legajo interno, DNI opcional
Legajo generado por la app. El DNI es opcional (no todas las escuelas lo
facilitan) y se guarda cifrado si existe. Al crear un estudiante, la app sugiere
coincidencias por nombre y apellido, y ofrece unificar o descartar: **resolución
de duplicados asistida**, nunca automática y silenciosa.

### T21 — Backend obligatorio, cliente local-first
El QR del estudiante y el acceso multi-dispositivo lo exigen. La captura en aula
sigue siendo offline-first.

### T22 — Modelo de negocio inicial: gratuito
Acceso con login de Google, sin pago, hasta validar uso real en un ciclo
lectivo. Después, pago mínimo por docente como contribución al mantenimiento.
Primer usuario: el propio autor del producto.

### T23 — Nombre: `teacher-service` como nombre interno
El repo, los paquetes y las rutas usan `teacher-service`. El nombre comercial se
define antes de difundir.

### T24 — Mobile-first con PWA instalable
El docente carga asistencia y notas **desde el celular**, en el aula, con el
teléfono en la mano. El escritorio es la excepción (planificación, informes).

- **Diseño mobile-first**: se resuelve primero en pantalla de 375 px; el layout
  de escritorio es una adaptación, no el punto de partida.
- **Tailwind v4+** como sistema de estilos, configurado en `kernel-ui`.
- **PWA instalable** en Android e iOS: manifiesto, service worker y caché de
  assets. Se instala desde el navegador y se abre como app nativa, sin stores.
- **Targets de toque** de 44 px mínimo; nada que dependa de hover.
- **Carga por teclado en escritorio** y por teclado numérico en móvil: el mismo
  flujo, distinto input.

Consecuencia para el kernel: `kernel-ui` y `kernel-client` (service worker +
cola offline) se necesitan **desde la primera vertical**, no en la segunda.

### T25 — TDD obligatorio, con foco en bordes y rutas críticas
Toda implementación se hace con tests. No se acepta código sin test que lo
cubra.

- **Tests primero o junto con el código**, nunca después.
- **Cobertura de bordes y rutas críticas**, no 100% de líneas: errores de red,
  reintentos, duplicados de sync, estados vacíos, permisos denegados, límites de
  fecha y de rango de notas.
- **El camino feliz no cuenta como cobertura**: un test que solo verifica que
  guardar funciona no prueba nada.
- **CI bloquea el merge** si los tests fallan o si baja la cobertura de las
  rutas críticas.

Consecuencia para el kernel: `kernel-conformance` es el arnés de pruebas de las
rutas críticas de infraestructura (sync, idempotencia, alcance). El dominio de
`teacher-service` se prueba aparte con sus propias reglas.

---

## 3. Modelo de datos

### 3.1 Entidades

```
Docente (tenant)
 └─ Escuela            (nombre, jurisdicción, calendario institucional)
     ├─ Calendario     (períodos, ventanas de intensificación, feriados, cierres)
     └─ Curso          (materia, división, año, horario, ciclo lectivo)
         ├─ Clase      (fecha, estado, motivo de cancelación)
         │   ├─ Tema dictado (vínculo al Tema del plan que se dictó)
         │   ├─ Asistencia   (alumno, estado)
         │   └─ Tarea         (contenido; tema opcional)
         ├─ Tema       (orden en el plan, contenido)
         └─ Evaluación (nombre, período, peso)
             └─ Nota   (alumno, valor)

Alumno (legajo interno; DNI opcional)
 └─ Matrícula (año, curso, materia, estado)
     ├─ Valoración     (período, tipo: preliminar TEA/TEP/TED)
     ├─ Intensificación (ventana, resultado, motivo)
     └─ Registro       (fecha, tipo, detalle)   ← conducta, lectoescritura, derivación
```

**Reconciliación de la valoración (ADR 0013).** La `Valoración` de este árbol es la
**preliminar cualitativa** (`TEA`/`TEP`/`TED`, mitad de cuatrimestre; T17/§13.1). La
**valoración numérica final** (cierre de cuatrimestre) ya vive como `Nota` bajo
`Evaluación` (F-02, ADR 0012), no como una rama de `Valoración`. La captura de la
preliminar es un **acto por `(curso, período)`** (hoja batch, §1.3), aunque la
`Valoración` se conciba por `Matrícula` una vez que F-06 la modele.

**Reconciliación del registro (ADR 0015).** El `Registro` de este árbol (bajo
`Matrícula`) se materializa en F-05 como un **log append-only por alumno**
(`StudentRecord`), keyeado por el **legajo** mientras `Matrícula` no exista (F-06):
entradas con fecha y tipo `observacion` (seguimiento global: rendimiento,
dificultades, acompañamiento, salud, conducta, comunicados), `movimiento`
(traslado/baja, con motivo) y `evaluacion` (evolución de un trabajo; **la última
nota manda**). Observaciones y movimientos son **globales** (cruzan cursos y años),
no por curso: es la base de la trayectoria.

### 3.2 Reglas de negocio

| Regla | Definición | Configurable |
|---|---|---|
| Aprobación de cuatrimestre | nota ≥ **7** (default PBA) | sí, por escuela |
| Aprobación de intensificación | nota ≥ **4** (escala 4–10, PBA) | sí, por escuela |
| Valoración preliminar | TEA / TEP / TED a mitad de cuatrimestre | — |
| Intensificación | nota < 7 en el cuatrimestre correspondiente | sí |
| Trayectoria | no aprobó las instancias del año ⇒ `adeudada` | sí |
| Clase válida | no cancelada, no feriado, no cierre institucional, dentro del período | sí |
| Cronograma | temas en orden × clases válidas (derivado) | — |

**Umbrales por instancia, no uno solo.** Regular = 7; intensificación = 4.
Modelar un único "mínimo aprobatorio" es incorrecto para PBA.

### 3.3 Períodos y calendario

El **calendario institucional es un dato configurable por escuela**, no una
constante. Contiene:

| Elemento | Ejemplo (PBA) | Configurable |
|---|---|---|
| Cuatrimestres | C1 y C2 | fijo: 2 por ciclo |
| Valoración preliminar | mitad de C1 (mayo), mitad de C2 (octubre) | sí, fechas |
| Ventanas de intensificación | inicio y cierre de cada cuatrimestre | **sí, por escuela** |
| Cierre de cuatrimestre | fin de C1, fin de C2 | sí, fechas |
| Feriados y jornadas institucionales | calendario DGCyE + actos de la escuela | sí |

Una escuela puede intensificar todo noviembre; otra, solo las últimas dos
semanas. Ambas deben caber sin cambio de código. El calendario es **insumo** del
cronograma, de la planificación por fechas y de los avisos.

### 3.4 Estados

- `Clase`: `dictada` · `cancelada(motivo)` · `feriado` · `sin_clase`
- `Asistencia`: `presente` · `ausente` · `tarde` · `justificada` · `retirado`
- `Matrícula`: `cursando` · `intensificando` · `adeudada` · `aprobada` · `libre`
- `Intensificación`: `pendiente` · `en_curso` · `aprobada` · `no_aprobada`
- `Valoración`: `TEA` · `TEP` · `TED` (preliminar) — la numérica 1–10 (final) es la `Nota` de `Evaluación` (F-02)

Los motivos de cancelación son datos, no un enum cerrado: paro, desinfección,
falta de agua, falta de luz, baños, jornada institucional, otro.

### 3.5 Derivaciones clave

- **Cronograma**: `temas ordenados × clases válidas`. Cancelar recalcula.
- **Intensificación**: `matrículas con nota < 7 en C1 o C2`.
- **Trayectoria**: `matrículas con estado adeudada, de cualquier año`.
- **Planilla**: `notas + valoraciones + asistencias + matrículas` mapeadas a la
  plantilla oficial.
- **Riesgo**: `asistencia < umbral` ∪ `valoración TED` ∪ `trabajos sin entregar`.

---

## 4. Alcance por versión

### v1 — el ritual y el artefacto

| ID | Feature |
|---|---|
| F-01 | Captura de clase: asistencia + tema del día + tarea, offline, por teclado |
| F-02 | Calificaciones offline (numéricas) |
| F-03 | Valoración preliminar TEA/TEP/TED a mitad de cuatrimestre |
| F-04 | Planilla oficial PBA en PDF, lista para imprimir y firmar |
| F-05 | QR del alumno: su trayectoria en esa materia y qué le falta |
| F-06 | Alta de alumno con legajo generado y detección de duplicados |

El modelo de §3 se implementa **completo** en v1 aunque no todo tenga UI
(calendario configurable, matrícula por año, períodos). Agregar esas columnas
después, con datos cargados, no es barato.

### v2 — el dolor anual

| ID | Feature |
|---|---|
| F-07 | Importar planilla de Sheets/Excel |
| F-08 | Cancelación de clase con reprogramación automática del tema |
| F-09 | Libro de temas imprimible con trazabilidad |
| F-10 | Intensificación auto-poblada, con motivo derivado |
| F-11 | Trayectoria: adeudan materia de años anteriores, con búsqueda por nombre/legajo |
| F-12 | Cierre de cuatrimestre: checklist + artefactos en un click |
| F-13 | Simulador "qué necesita para aprobar" |
| F-14 | WhatsApp prellenado a tutores (`wa.me`) |
| F-15 | Calendario institucional configurable por escuela (ventanas de intensificación) |

### v3 — la ventaja que Sheets no puede dar

| ID | Feature |
|---|---|
| F-16 | Riesgo temprano accionable ("3 alumnos en riesgo: 2 por asistencia, 1 por trabajos") |
| F-17 | Timeline unificado del alumno |
| F-18 | Informes con permisos a nivel de campo y vistas por rol |
| F-19 | Horario semanal multi-escuela ("hoy: 3°1° en Escuela A 8:00") |
| F-20 | Planificación reutilizable año a año |
| F-21 | Portabilidad total: export ZIP de todo |
| F-22 | Registro diario por alumno (conducta, lectoescritura, derivación) |
| F-23 | Unificación de duplicados asistida (merge manual supervisado) |

### Backlog (no comprometido)

| ID | Feature | Nota |
|---|---|---|
| F-24 | Mapa de asientos y mapa del aula | Vende la demo, no retiene. Barato, alto impacto visual |
| F-25 | Plantillas de llamado de atención para imprimir | |
| F-26 | Rúbricas + banco de comentarios | |
| F-27 | Modo suplencia (acceso temporal acotado) | |
| F-28 | Firma digital + QR de verificación de autenticidad | Diferencial, no urgente |
| F-29 | Dictado por voz para observaciones | Depende de conectividad |
| F-30 | Video de difusión con features actuales y futuras | Para grupos de WhatsApp |

---

## 5. UI / navegación

Sidebar del docente:

| Ítem | Contenido |
|---|---|
| **Hoy** | Clases del día en todas las escuelas, con acceso directo a tomar asistencia |
| **Cursos** | Lista agrupada por escuela; dentro: alumnos, plan, notas, asistencias, mapa |
| **Plan clase a clase** | Cronograma derivado, con temas y estados de clase |
| **Asistencias** | Vista por curso y por alumno, con porcentaje y alertas |
| **Calificaciones** | Carga rápida, valoraciones TEA/TEP/TED, proyección, simulador |
| **Intensificación** | **Cards** de alumnos que intensifican en el año en curso, con motivo derivado |
| **Trayectoria** | **Cards** de alumnos que adeudan la materia de años anteriores, con búsqueda por nombre o legajo |
| **Alumnos** | Timeline individual: asistencia, notas, trabajos, conducta, derivaciones |
| **Informes** | Generación con selección de campos visibles |
| **Apuntes** | Material compartido con los cursos |
| **Ajustes** | Escalas, umbrales por instancia, calendario, plantillas, export |

Las dos pantallas de cards (Intensificación y Trayectoria) son el corazón
emocional del producto: responden "¿a quién tengo que mirar?" sin abrir una
planilla.

---

## 6. Exportación e impresión

- **Plantilla oficial**: layout + mapeo de campos, versionados como datos.
  Identificadas por `(jurisdicción, nivel, año)`. Sin release para actualizar.
  La primera plantilla es **PBA secundaria**.
- **Salida**: PDF listo para imprimir y firmar al pie. También Excel/CSV.
- **Informe de valoración preliminar**: TEA/TEP/TED a mitad de cuatrimestre
  (mayo y octubre), con la asistencia y la continuidad de la trayectoria.
- **Libro de temas**: PDF con trazabilidad de reprogramaciones.
- **Informes**: selección de campos por checkbox; vistas por rol (preceptor,
  dirección, tutor, alumno) con permisos a nivel de campo.
- **Enlace público**: alternativa al PDF, con token de T9.

---

## 7. Prohibiciones duras

1. **No guardar la planilla como tabla editable.** Es una vista.
2. **No guardar fechas de temas en el plan.** El cronograma se deriva.
3. **No editar la fecha de un tema al cancelar una clase.** Se recalcula.
4. **No identificar al alumno por posición en la lista.** Legajo interno; DNI
   opcional y cifrado.
5. **No usar códigos cortos adivinables en el acceso público.**
6. **No integrar con el sistema provincial.** Se exporta.
7. **No asumir que la escuela adopta el sistema.**
8. **No hardcodear fechas, ventanas de intensificación ni umbrales.** Son datos
   del calendario institucional y de la configuración de la escuela.
9. **No usar un único umbral aprobatorio.** Regular = 7; intensificación = 4.
10. **No agregar features que no sean velocidad de ritual o calidad de artefacto.**

---

## 8. Offline

| Acción | Offline | Nota |
|---|---|---|
| Tomar asistencia | ✅ | cola + idempotencia |
| Cargar notas | ✅ | cola + idempotencia |
| Cargar valoración TEA/TEP/TED | ✅ | cola |
| Tema del día / tarea | ✅ | cola |
| Ver planilla / cronograma | ✅ | caché de lectura |
| Generar PDF oficial | ⚠️ | requiere datos completos; evaluar render local |
| Importar planilla | ❌ | requiere conexión |
| Acceso del alumno por QR | ❌ | requiere conexión (servidor) |

Un solo escritor por tenant ⇒ sin merge. El conflicto posible es el mismo
docente en dos dispositivos: última escritura gana, y la UI lo advierte.

---

## 9. Implicancias para el kernel

| Capacidad | Dónde vive | Estado en `kernel-context.md` |
|---|---|---|
| Envelope + error codes | `kernel-contracts` / `kernel-http` | ya previsto |
| Idempotencia | `kernel-http` | ya previsto |
| Alcance / tenant | `kernel-scope` | ya previsto |
| Outbox / log de eventos | `kernel-domain` + `kernel-persistence` | ya previsto |
| Cola offline + flush | `kernel-client` | ya previsto |
| **Acceso público por token** | `kernel-http` | **NUEVO — no contemplado** |
| **Renderizado de documentos (PDF)** | `kernel-documents` | **NUEVO — no contemplado** |
| **Storage de archivos** | `kernel-storage` | **NUEVO — no contemplado** |
| **Importación de planillas** | `kernel-import` o vertical | **NUEVO — decidir** |
| **Configuración por tenant** (calendario, umbrales, plantillas) | `kernel-config` | **CONFIRMADO — entra el día 1 (D19)** |
| Plantillas de documentos | vertical (datos) | — |
| Vistas derivadas / proyecciones | patrón, no paquete | — |

Los demás "NUEVO" (token público, PDF, storage, importación) aparecen en
`teacher-service` pero probablemente también en `store-service` (comprobante por
QR, imágenes de producto, import de catálogo). **No se implementan ahora**: se
registran como candidatos para la segunda vertical, que es la que valida la
intersección.

**`kernel-config` no espera a la segunda vertical** (D19). Es el único que se
promueve desde el día 1 porque las tres verticales lo necesitan con la misma
semántica: configuración por tenant que no es código. Es la misma familia que
`business-settings` en `tech-service`, pero con semántica real de configuración y
no de branding.

---

## 10. Preguntas abiertas

Resueltas en esta revisión (§2, T15–T23): jurisdicción, escala y umbrales,
cuatrimestres y ventanas, alcance del alumno, identidad, backend, modelo de
negocio. Queda **una sola abierta**:

1. **Nombre comercial.** `teacher-service` es el nombre interno. El comercial se
   define antes de difundir (F-30).

### Decisiones de negocio diferidas (no bloquean nada)

| Tema | Hipótesis de trabajo |
|---|---|
| Precio futuro | Pago mínimo por docente, como contribución al mantenimiento |
| Difusión | Grupos de WhatsApp de la escuela + video con features actuales y futuras |
| Validación | Un docente real (el autor), un ciclo lectivo completo |

### Dudas de implementación (se resuelven al construir, no antes)

| Tema | Cuándo se decide |
|---|---|
| Render de PDF en cliente vs servidor | **resuelto en F-04**: servidor, determinista (ADR 0014); el render local/offline queda diferido |
| Algoritmo de similitud para duplicados | al construir F-06 / F-23 |
| Voz para observaciones | si F-29 entra en alcance |

---

## 11. Protocolo de trabajo

- **Un chat por feature o micro-cambio.** Nunca dos features en el mismo chat.
- El chat cita `F-xx` y este documento. No se re-litigan §2 ni §3.
- Si un feature exige cambiar el modelo de datos: **parar y proponer ADR**.
- Criterio de terminado: build + tests del feature + este documento actualizado
  si cambió el alcance.
- Si el feature contradice §7: está mal el feature, no la prohibición.

---

## 12. Nivel de certeza

- **Nivel 1 (verificado)**: el cliente es el docente; Sheets/Excel dominan; la
  planilla oficial es el artefacto que la institución acepta; la cancelación con
  reprogramación y la trayectoria entre años son dolores reales sufridos por el
  usuario. Régimen PBA confirmado por fuente oficial (ver §13): TEA/TEP/TED,
  2 cuatrimestres, intensificación con nota 4–10.
- **Nivel 2 (decisión razonada)**: legajo interno con DNI opcional; calendario
  institucional como dato; plantillas como datos; v1 acotada a seis features.
- **Nivel 3 (⚠️ sin validar)**: si el docente carga más rápido que en Sheets; si
  la plantilla PBA es replicable sin acuerdos formales; adopción real más allá
  del autor; viabilidad del pago futuro.

---

## 13. Anexo normativo — Provincia de Buenos Aires

Fuente: **Resolución 1650/24** (DGCyE, *Régimen Académico* de la Educación
Secundaria), con la **Disposición 40/26** (complementaria / aclaratoria). Base
previa: Resolución 1236/23 y sus Anexos de *Evaluación y Acreditación*
(IF-2024-19739952-GDEBA-DPESECDGCYE, IF-2024-20106082-GDEBA-DPESECDGCYE).
Verificado en octubre de 2026 (§13.4): se mantienen la organización en dos
cuatrimestres, la valoración preliminar TEA/TEP/TED, los umbrales (≥7 / 4–10) y la
asistencia del 75% por materia; difiere el número de momentos de intensificación
(ver §13.2). Los formularios oficiales citados por DGCyE son el *Registro Anual de
Calificaciones* y el *RITE*.

### 13.1 Valoraciones

| Momento | Tipo | Valores |
|---|---|---|
| Mitad de cada cuatrimestre (mayo, octubre) | **Preliminar cualitativa** | TEA / TEP / TED |
| Cierre de cada cuatrimestre | **Numérica** | 1–10, registrada en el RITE |

- **TEA** — Trayectoria Educativa Avanzada.
- **TEP** — Trayectoria Educativa en Proceso.
- **TED** — Trayectoria Educativa Discontinua.

La valoración preliminar comunica a estudiantes y familias los avances y las
situaciones de asistencia o discontinuidad. No reemplaza la nota numérica de
cierre.

### 13.2 Acreditación e intensificación

- Se aprueba la materia con nota **≥ 7** al cierre del cuatrimestre.
- Quien no alcanza ese umbral pasa a **intensificación**, donde aprueba con
  **4 a 10**.
- La intensificación es **por cuatrimestre**: se intensifican solo los contenidos
  pendientes del período no aprobado.
- Existen **seis momentos** en el año: al **inicio y al cierre de cada**
  cuatrimestre (RA vigente, Res. 1650/24).
- La **asistencia** se acredita con el **75%** de las clases de la materia.
- **Cada escuela define la forma y la duración** de cada ventana según normativa
  → por eso el calendario es configurable (T18).

### 13.3 RITE

**Registro Institucional de Trayectorias Educativas**: **lo completa dirección**,
no el docente. La app **no integra** con el RITE (T8): el artefacto del docente es
la **planilla impresa** que llena con las calificaciones y el cierre de cada
período (informe o cuatrimestre/año), para transcribir o imprimir.

### 13.4 Advertencia de vigencia

La normativa educativa cambia por resolución. **Verificación hecha al construir
F-04** (octubre 2026): el régimen vigente es la **Res. 1650/24** (*Régimen
Académico*) con la **Disp. 40/26**; la foto de Res. 1236/23 quedó **superada**
(ver §13). Este anexo sigue siendo una foto, no una verdad permanente: antes de
reconstruir la **plantilla** oficial, confirmar la forma del formulario del ciclo
en curso (la plantilla es dato versionado, corregible sin release — T7, ADR 0014).
