## Qué cambia

<!-- Una frase. Es el mensaje de commit del squash. -->

## Por qué

<!-- El problema o la decisión que motiva el cambio. -->

## Cómo se verificó

<!-- Tests agregados/corridos; o cómo se verificó a mano y por qué. -->

## Checklist

- [ ] El cambio pertenece a **una sola** feature o micro-cambio.
- [ ] Leí `docs/kernel-context.md` §6 (prohibiciones duras) y no las violé.
- [ ] Si toqué el modelo de datos de un producto, **paré y propuse un ADR**
      (`docs/adr/`) antes de escribir código.
- [ ] Si el cambio contradice una decisión `D*`/`T*`, lo señalé en lugar de
      implementarlo en silencio.
- [ ] **Escribí los tests antes o junto con el código**, cubriendo bordes y
      rutas críticas (no solo el camino feliz). Si no aplica, lo justifiqué.
- [ ] Revisé la UI en **viewport móvil de 375 px** (si el cambio tiene UI).
- [ ] Actualicé el documento de producto/kernel si cambió el alcance.
- [ ] El título de este PR es un buen mensaje de commit.

> El merge lo hace una persona desde la web (**squash**). Un agente abre el PR y
> se detiene aquí.
