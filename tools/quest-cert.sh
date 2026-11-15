#!/bin/sh
# Makes the self-signed certificate `npm run dev:quest` needs, for this computer's Wi-Fi address. Kept in .certs/ (git-ignored).
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1)
mkdir -p .certs
if [ ! -f .certs/cert.pem ] || ! openssl x509 -in .certs/cert.pem -noout -text | grep -q "IP Address:$IP"; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout .certs/key.pem -out .certs/cert.pem -days 30 \
    -subj "/CN=lunar-navigator-dev" -addext "subjectAltName=IP:$IP,DNS:localhost,IP:127.0.0.1" 2>/dev/null
fi
echo "On the Quest (same Wi-Fi), open:  https://$IP:5443"
