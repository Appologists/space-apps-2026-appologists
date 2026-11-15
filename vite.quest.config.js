// `npm run dev:quest`: the app on your Wi-Fi over https, so a Meta Quest (or a phone) can open it and use VR.
// WebXR only runs on https (or localhost). The certificate is self-made (`npm run dev:quest` makes it once, see
// tools/quest-cert.sh); the headset warns about it once ("Advanced" -> "Proceed"). Not for the hosted site.
import { readFileSync } from 'node:fs';
import base from './vite.config.js';

export default {
  ...base,
  server: {
    ...base.server,
    host: true, // listen on the Wi-Fi too, not just this computer
    https: { key: readFileSync('.certs/key.pem'), cert: readFileSync('.certs/cert.pem') },
  },
};
