// Legal: kernel-config SÍ puede usar los puertos de dominio y el seam de alcance.
// Prueba que la regla 'sin frameworks' no sobre-dispara por esos imports.
import '@kernel/domain';
import '@kernel/scope';

export const usesDomain = true;