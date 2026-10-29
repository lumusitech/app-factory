import type { ScopeResolver } from '@kernel/http';
import { buildScope } from '@kernel/scope';

/**
 * Placeholder de identidad → alcance ([`docs/contracts/scope.md`](../../../docs/contracts/scope.md) §4).
 *
 * La **autenticación** real (login de Google, T22) y el **token público** (T9)
 * son contratos aparte: el kernel solo exige que su resultado se materialice en
 * un `ScopeContext`. Este stub lee el tenant del header `x-tenant` para que la
 * vertical arranque cableada; **reemplazalo** por el resolver real antes de
 * producción (no es un mecanismo de autenticación).
 */
export type SessionResolver = Exclude<ScopeResolver, null>;

export const headerSessionResolver: SessionResolver = (request) => {
  const raw = request.headers['x-tenant'];
  const tenantId = Array.isArray(raw) ? raw[0] : raw;
  if (typeof tenantId !== 'string' || tenantId === '') {
    return null;
  }
  return buildScope({ tenantId, actor: { kind: 'user', id: 'dev-user' } });
};
