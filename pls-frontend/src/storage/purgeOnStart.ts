// Imported first by main.tsx so the purge runs before any store module loads. The stores read
// only namespaced keys, so they never see legacy values even if this ran late; the purge makes
// sure the old values do not linger on the device either.
import { purgeLegacyStorage } from './keys';

try {
  purgeLegacyStorage();
} catch {
  // Storage unavailable (private mode, quota): nothing to purge.
}
