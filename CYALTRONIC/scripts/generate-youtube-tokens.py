#!/usr/bin/env python3
"""
YouTube Token Generator para CYALTRONIC
Genera PO Token y Visitor Data para yt-dlp

Opciones de instalacion:

OPCION A - Docker (mas simple):
  docker run --name bgutil-provider -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider

OPCION B - Node.js nativo:
  git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
  cd bgutil-ytdlp-pot-provider/server/
  npm install
  npx tsc
  node build/main.js

Uso:
  python3 generate-youtube-tokens.py
"""

import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instalando requests...")
    os.system("pip3 install --break-system-packages requests")
    import requests

TOKENS_FILE = Path(__file__).parent.parent / "youtube-tokens.json"
BGUTIL_SERVER_URL = os.environ.get("BGUTIL_SERVER_URL", "http://127.0.0.1:4416")

def generate_from_bgutil_server():
    """Obtiene tokens del servidor HTTP de bgutil-ytdlp-pot-provider"""
    try:
        print(f"🔄 Conectando a servidor bgutil en {BGUTIL_SERVER_URL}...")

        # El endpoint correcto es /token
        resp = requests.post(
            f'{BGUTIL_SERVER_URL}/token',
            json={},
            timeout=60,
            headers={'Content-Type': 'application/json'}
        )

        if resp.status_code != 200:
            print(f"❌ Error HTTP {resp.status_code}: {resp.text}")
            return None

        data = resp.json()

        # La respuesta tiene formato: {"poToken": "...", "visitorData": "..."}
        if data.get('poToken') or data.get('po_token'):
            po_token = data.get('poToken') or data.get('po_token', '')
            visitor_data = data.get('visitorData') or data.get('visitor_data', '')

            print(f"✅ PO Token obtenido: {po_token[:30]}...")
            print(f"✅ Visitor Data: {visitor_data[:30]}...")

            return {
                "poToken": po_token,
                "visitorData": visitor_data,
                "method": "bgutil-server"
            }
        else:
            print(f"❌ Respuesta sin tokens: {data}")
            return None

    except requests.exceptions.ConnectionError:
        print(f"❌ No se pudo conectar a {BGUTIL_SERVER_URL}")
        print("\n📋 Para iniciar el servidor bgutil:")
        print("\n   OPCION A - Docker (recomendado):")
        print("   docker run --name bgutil-provider -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider")
        print("\n   OPCION B - Node.js:")
        print("   git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git")
        print("   cd bgutil-ytdlp-pot-provider/server/")
        print("   npm install && npx tsc && node build/main.js")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def prompt_manual_input():
    """Pide al usuario ingresar los tokens manualmente"""
    print("\n" + "="*60)
    print("📋 INGRESO MANUAL DE TOKENS")
    print("="*60)
    print("""
Para obtener los tokens manualmente:

1. Abre YouTube (https://www.youtube.com) en Chrome/Firefox
   IMPORTANTE: NO inicies sesion (modo incognito recomendado)

2. Abre DevTools (F12) → pestaña Network

3. Filtra por 'v1/player'

4. Reproduce cualquier video

5. En el request 'player', ve a la respuesta (Response)

6. Busca 'serviceIntegrityDimensions' → copia 'poToken'

7. Para visitorData, en la Console ejecuta:
   ytcfg.get('VISITOR_DATA')
""")

    po_token = input("🔐 Ingresa el PO Token (o Enter para omitir): ").strip()
    visitor_data = input("👤 Ingresa el Visitor Data (o Enter para omitir): ").strip()

    if po_token or visitor_data:
        return {
            "poToken": po_token,
            "visitorData": visitor_data,
            "method": "manual"
        }

    return None

def save_tokens(tokens):
    """Guarda los tokens en el archivo JSON"""
    data = {
        "poToken": tokens.get("poToken", ""),
        "visitorData": tokens.get("visitorData", ""),
        "generatedAt": int(time.time() * 1000),
        "failCount": 0,
        "method": tokens.get("method", "unknown")
    }

    with open(TOKENS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"\n✅ Tokens guardados en: {TOKENS_FILE}")
    print(f"   PO Token: {'✓ Presente (' + str(len(data['poToken'])) + ' chars)' if data['poToken'] else '✗ No disponible'}")
    print(f"   Visitor Data: {'✓ Presente' if data['visitorData'] else '✗ No disponible'}")
    print(f"   Metodo: {data['method']}")

def check_existing_tokens():
    """Verifica si ya existen tokens validos"""
    try:
        if TOKENS_FILE.exists():
            with open(TOKENS_FILE, 'r') as f:
                data = json.load(f)

            age_hours = (time.time() * 1000 - data.get('generatedAt', 0)) / (1000 * 60 * 60)
            fail_count = data.get('failCount', 0)

            if data.get('poToken') and age_hours < 12 and fail_count < 3:
                print(f"📋 Tokens existentes encontrados:")
                print(f"   Edad: {age_hours:.1f} horas")
                print(f"   Fallos: {fail_count}")
                print(f"   PO Token: {data['poToken'][:30]}...")

                choice = input("\n¿Deseas regenerar los tokens? (s/n): ").strip().lower()
                if choice != 's':
                    print("✅ Usando tokens existentes")
                    return True
    except Exception as e:
        print(f"Error leyendo tokens existentes: {e}")

    return False

def main():
    print("="*60)
    print("🎵 YOUTUBE TOKEN GENERATOR - CYALTRONIC")
    print("="*60)
    print()

    # Verificar tokens existentes
    if check_existing_tokens():
        return

    tokens = None

    # Intentar servidor bgutil
    tokens = generate_from_bgutil_server()

    # Si no hay servidor, ofrecer entrada manual
    if not tokens:
        print("\n⚠️ Servidor bgutil no disponible")
        choice = input("\n¿Deseas ingresar los tokens manualmente? (s/n): ").strip().lower()
        if choice == 's':
            tokens = prompt_manual_input()

    # Guardar tokens si se obtuvieron
    if tokens and (tokens.get("poToken") or tokens.get("visitorData")):
        save_tokens(tokens)
        print("\n🎉 ¡Configuracion completada!")
        print("   Reinicia el bot para usar los nuevos tokens")
    else:
        print("\n❌ No se configuraron tokens")
        print("\n📋 Opciones para obtener tokens:")
        print()
        print("   1. DOCKER (mas simple):")
        print("      docker run --name bgutil-provider -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider")
        print("      python3 generate-youtube-tokens.py")
        print()
        print("   2. NODE.JS:")
        print("      git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git")
        print("      cd bgutil-ytdlp-pot-provider/server/ && npm install && npx tsc")
        print("      node build/main.js &")
        print("      python3 generate-youtube-tokens.py")
        print()
        print("   3. MANUAL: Corre este script de nuevo y elige la opcion manual")

if __name__ == "__main__":
    main()
