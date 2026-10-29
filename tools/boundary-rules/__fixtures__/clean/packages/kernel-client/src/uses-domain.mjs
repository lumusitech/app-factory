// Legal: kernel-client SÍ puede usar los contratos y los puertos de dominio.
// Prueba que la regla 'sin frameworks' no sobre-dispara por esos imports.
import '@kernel/contracts';
import '@kernel/domain';

export const usesDomain = true;
