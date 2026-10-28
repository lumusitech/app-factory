# Esto no se extrae al kernel

> Documento normativo. La lista **negativa** de la fase de diseño: qué **no**
> entra al kernel compartido y por qué. Donde el
> [contrato de alcance](scope.md) dice cómo se aplica el aislamiento y el
> [contrato de evolución](evolution.md) dice cómo cambia el esquema, esta lista
> fija la **frontera de admisión**: lo que se queda en la vertical, lo que se
> descarta y lo que se difiere.
>
> Entregable de la fase 0 ([`docs/kernel-context.md`](../kernel-context.md) §5,
> última línea: *"Y una lista de «esto no se extrae y por qué»"*). **Elabora**
> decisiones ya cerradas —§1.2 (anti-patrones), §1.3 (`school-service`), §1.4
> (columna "vertical" de la intersección), §2 (la regla de intersección), §2.1
> (los tres cubos), D8, D9, D10, D11, D12, D13, D14, D17, D18, D19, D21, D23—
> y **no introduce ninguna decisión nueva**. Por eso **no lleva ADR** (§8); los
> cuatro contratos sí lo llevan porque cada uno cerró decisiones que ninguna `D*`
> resolvía del todo.

- **Estado:** propuesto (borrador para revisión de la fase 0)
- **Ámbito:** la frontera de admisión del kernel. Qué se queda en la vertical, qué
  se descarta del portafolio y qué candidato se difiere; **no** describe
  implementación ni crea paquetes.
- **Decisiones relacionadas:** §1.1, §1.2, §1.3, §1.4, §2, §2.1, §4, §5, §6, §7,
  §11.3; D6, D7, D8, D9, D10, D11, D12, D13, D14, D17, D18, D19, D21, D23, D25;
  [ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md),
  [0002](../adr/0002-decisiones-contrato-sync.md),
  [0003](../adr/0003-decisiones-contrato-alcance.md),
  [0004](../adr/0004-decisiones-contrato-evolucion.md).

---

## 1. Para qué sirve esta lista y la regla de admisión

El kernel no se extrae del repo auditado: se **escribe contra contratos**, y el
repo original solo aporta la *semántica* ya validada por tests (§1, conclusión de
§1.2). Esta lista es la contracara explícita de la
[intersección verificada de §1.4](scope.md): la intersección dice **qué sí** es
kernel; esta lista dice **qué no** y con qué fundamento.

La regla que gobierna la frontera es la de §2:

> **El kernel satisface la intersección de las verticales, nunca la unión.**
> Lo que solo necesita una vertical se queda en esa vertical.

Su corolario operativo: *"cada vez que algo entra al kernel «por si acaso», ya se
perdió"*. Y su pregunta de admisión, brutal y simple (§2):

> ¿Una app de asistencia docente y una de inventario de almacén necesitan esto
> **con exactamente la misma semántica**?

Si la semántica difiere, **no es kernel**: es una *política que la vertical
configura* (§2). Todo lo que sigue es una instancia concreta de ese rechazo.

Esta lista **no duplica** los *"Fuera de alcance"* de cada contrato (idempotency
§12, sync §11, scope §11, evolution §10): aquellos acotan **un** mecanismo; este
acota la **admisión al kernel** en conjunto.

---

## 2. Los tres cubos (§2.1)

Toda capacidad cae en uno de tres cubos. Solo el primero es kernel:

| Cubo | Qué es | Destino |
|---|---|---|
| **Kernel-esencial** | Invariantes con semántica idéntica en cualquier vertical | **kernel** |
| **Accidentalmente-de-dominio** | Parece infraestructura, pero codifica las reglas de una vertical | **vertical** (no se extrae) |
| **Local** | Genuinamente del producto | **vertical** |

Esta lista cubre los cubos 2 y 3, más lo que se **descarta** (fuera del
portafolio) y lo que se **difiere** (D18). Ningún cubo se "promueve" por
conveniencia: la promoción exige la segunda instancia (§2, ODD #3, D23).

---

## 3. La columna "vertical" de la intersección (§1.4)

La intersección de §1.4 tiene una fila cuyo veredicto es **❌ vertical**:

| Capacidad | teacher | store | tech | Veredicto |
|---|---|---|---|---|
| **Órdenes / notas / stock / cursos** | local | local | local | **❌ vertical** |

**Por qué no se extrae:** son las **entidades del dominio de cada producto**, no
una mecánica compartida. Una orden de taller, una nota de alumno y un ítem de
stock no comparten semántica: cambian el agregado, sus invariantes y su máquina de
estados. Extraerlas sería satisfacer la **unión**, no la intersección (§2).

**Consecuencia (§1.4, advertencia de alcance):** la intersección de tres productos
es *"sorprendentemente chica"*. Todo lo demás —`activos`, `dispositivos`, `stock`,
`cursos`, `órdenes`— es vertical. **El kernel arranca flaco a propósito.**

Estas entidades **sí** usan el kernel: consumen sync offline, alcance, outbox e
idempotencia, pero **el agregado y sus reglas viven en la vertical** (no se
inyectan al kernel).

---

## 4. Anti-patrones observados que no se replican (§1.2)

Estos patrones están tomados de la auditoría del repo original y **no se
extraen** como kernel (ni se copian): cada uno tiene un remedio ya decidido.

| Anti-patrón (§1.2) | Por qué no se extrae / qué lo reemplaza |
|---|---|
| **Entidad ORM == modelo de dominio** — TypeORM dueño del agregado, sin separación dominio/infra | El ORM es **adaptador de salida**, nunca el modelo; entidad de persistencia + mapper explícito (**D7**) |
| **Scoping de autorización en el controller** — `filterDto.technicianId = user.id` a mano, opt-in y fácil de olvidar | El alcance se aplica en una **capa común**, imposible de omitir, no opt-in (**D11**); ver [contrato de alcance](scope.md) |
| **"Multi-tenant" que solo es branding** — `business-settings` sin `tenant_id` ni RLS | Multi-tenancy **real** o single-tenant explícito: con `tenant_id` hay RLS o scoping obligatorio (**D12**) |
| **Historial de migraciones squasheado** — 31 migraciones, 8 `*Init`, `migration:revert` sin forward-only | Migraciones **forward-only, un dueño por paquete**; el squash es un procedimiento explícito con ventana (**D13**); ver [contrato de evolución](evolution.md) |
| **Motor offline conociendo el dominio** — hardcodea endpoint de probe, rutas no encolables y un refresh key del dominio | El protocolo de sync es **documento + JSON Schema**, no código Angular; el cliente es parametrizado (**D14**); ver [contrato de sync](sync.md) |
| **Eventos in-process como si fueran durables** — `EventEmitter2` no sobrevive a rollback ni a reinicio | Eventos de dominio vía **outbox**, en la misma transacción; in-process solo para lo efímero (**D9**, **D10**) |
| **ID generado por la base** — `@PrimaryGeneratedColumn('uuid')`; el dominio no conoce el ID antes del `INSERT` | ID generado en el **dominio** (UUIDv7) vía puerto `IdGenerator` (**D8**) |

**Por qué la lista no se recicla como plantilla:** el repo original es
*evidencia, no plantilla* (§1). Se **cosechan los activos** (§1.1) y se
**descarta el diseño** (§1.2). El kernel se escribe contra contratos.

---

## 5. Candidatos de kernel diferidos (D18)

Registrados por `teacher-service`, estos candidatos **entran cuando la segunda
vertical los pida**. Si solo los pide una, se quedan en la vertical (D18, ODD #1):

| # | Candidato diferido | Fuerza (D18) | Destino |
|---|---|---|---|
| 1 | **`kernel-config`** — configuración por tenant que no es código | El más fuerte | **Promovido el día 1** (ver abajo, D19) |
| 2 | **Acceso público por token** — opaco, revocable, con vencimiento y alcance | Fuerte | Kernel **cuando la 2ª vertical lo pida** |
| 3 | **Renderizado de documentos (PDF)** — puerto; plantillas locales | Media | Igual: 2ª vertical |
| 4 | **Storage de archivos** — puerto | Media | Igual: 2ª vertical |
| 5 | **Importación de planillas / catálogos** — decidir si es kernel o vertical | Por decidir | Igual: 2ª vertical |

**Aclaración importante:** `kernel-config` **no** está en "lo que no se extrae".
Es el único candidato promovido sin esperar a la segunda vertical, porque **las
tres verticales lo necesitan con la misma semántica** (calendario, umbrales,
plantillas, catálogos, flags por tenant). Entra el **día 1** (**D19**);
diferirlo obligaría a inventar un mecanismo por vertical y luego unificarlo.
Alcance mínimo: almacén clave-valor por tenant con esquema versionado y
validación — **no** es un CMS ni un motor de reglas.

**Por qué se difieren los otros cuatro:** generalizar con n=1 está prohibido (§2,
ODD #3, §8). Registrarlos no los admite: la admisión la da la segunda instancia.

---

## 6. Fuera del portafolio: `school-service` (D18)

`school-service` (dirección escolar) **se descarta como vertical**: exige
adopción institucional y **jerarquía multi-nivel** (permisos por curso,
consolidación entre docentes) que **ninguna** vertical actual necesita (D18,
§1.3, §9 #8).

**Consecuencias:**

- El portafolio son **tres** productos: `teacher-service`, `store-service`,
  `tech-service` (§1.3).
- **Ninguna vertical necesita jerarquía de tenants**: el tenant es **plano**
  (D25). Ver el supuesto explícito en el [contrato de alcance](scope.md) §7.
- No se planifica ni se **pre-diseña** (§7). Si algún día aparece, se evalúa con
  el test de §2 —y, por D16, probablemente sea **otro producto** con su propio
  despliegue.

---

## 7. El repo original `tech-service` no se extrae (D17, D21)

El `tech-service` auditado **no se adapta ni se migra**: es *greenfield*. Queda
como **demo** de ese producto y como **fuente de semántica** (idempotencia,
sync), no de código (D17, D21).

- **No** hay convivencia Nest+TypeORM con Fastify+Zod: al reescribir desde cero,
  desaparece el problema de los dos adaptadores HTTP (D17).
- **No** se copia código ni se extraen paquetes del repo: se escribe contra los
  contratos (§1.1, "cosechar, no copiar").
- La *semántica* cosechada (idempotencia servidor, protocolo de replay, cola
  offline) ya está validada por los tests del original y vive en los contratos de
  [idempotencia](idempotency.md) y [sync](sync.md).

---

## 8. Por qué esta lista no lleva ADR

El [ADR](../adr/README.md) registra una decisión **explícita** que aún no está
decidida (D23.2; CONTRIBUTING §6). Esta lista **no decide nada nuevo**: solo
**compila y justifica** con el vocabulario ya cerrado del repo (§1.2, §1.3,
§1.4, §2, §2.1, §5, §6, §7; D8–D14, D17–D19, D21, D23, D25).

Por lo tanto:

- **No** contradice ni matiza ninguna `D*`.
- **No** introduce un contrato nuevo con decisiones propias.
- **No** lleva ADR. El evento explícito de D23.2 ya ocurrió en los cuatro
  contratos ([ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md)–[0004](../adr/0004-decisiones-contrato-evolucion.md));
  acá solo se **enuncia la frontera** que esas decisiones implican.

Si en el futuro alguien quisiera **cambiar** esta frontera (p. ej. promover un
candidato de D18 antes de que la segunda vertical lo pida), **eso** sí sería una
decisión nueva y exigiría un ADR, no una edición silenciosa de este documento.

---

## 9. Referencias

- [`docs/kernel-context.md`](../kernel-context.md) — §1.1 (activos a cosechar),
  §1.2 (anti-patrones), §1.3 (portafolio, `school-service`), §1.4 (intersección y
  columna "vertical"), §2 (la regla de admisión), §2.1 (los tres cubos), §4
  (arquitectura objetivo), §5 (contratos + esta lista), §6 (prohibiciones duras),
  §7 (plan por fases), §11.3 (despliegue).
- [`docs/adr/README.md`](../adr/README.md) — cuándo un cambio exige un ADR.
- [Contrato de idempotencia](idempotency.md) · [de sync](sync.md) · [de
  alcance](scope.md) · [de evolución](evolution.md) — cada uno con su propia
  sección *"Fuera de alcance"*.
- Decisiones: D6, D7, D8, D9, D10, D11, D12, D13, D14, D17, D18, D19, D21, D23,
  D25.
