#!/usr/bin/env python3
"""
YouTube Token Generator para CYALTRONIC
Genera PO Token y Visitor Data para yt-dlp

Uso:
  python3 generate-youtube-tokens.py

Instalar dependencias:
  pip3 install --break-system-packages requests

Para auto-generacion con BgUtils:
  pip3 install --break-system-packages bgutil
"""

import json
import os
import sys
import subprocess
from pathlib import Path

TOKENS_FILE = Path(__file__).parent.parent / "youtube-tokens.json"

def generate_with_bgutil():
    """Intenta generar tokens usando bgutil"""
    try:
        from bgutil import BgUtils
        print("🔄 Generando tokens con BgUtils...")
        bg = BgUtils()
        po_token = bg.get_po_token()
        visitor_data = bg.get_visitor_data()

        if po_token:
            return {
                "poToken": po_token,
                "visitorData": visitor_data or "",
                "method": "bgutil"
            }
    except ImportError:
        print("⚠️ bgutil no está instalado")
        print("   Instalar: pip3 install --break-system-packages bgutil")
    except Exception as e:
        print(f"❌ Error con bgutil: {e}")

    return None

def generate_with_bgutil_server():
    """Intenta obtener tokens del servidor HTTP de bgutil"""
    try:
        import requests
        print("🔄 Intentando servidor HTTP de bgutil (puerto 4416)...")
        resp = requests.get('http://127.0.0.1:4416/generate', timeout=30)
        data = resp.json()

        if data.get('potoken'):
            return {
                "poToken": data['potoken'],
                "visitorData": data.get('visitor_data', ''),
                "method": "bgutil-server"
            }
    except Exception as e:
        print(f"⚠️ Servidor bgutil no disponible: {e}")

    return None

def generate_with_nodejs():
    """Intenta generar tokens usando el script de Node.js"""
    try:
        print("🔄 Intentando con Node.js...")
        # Este método requiere que tengas un script de Node.js configurado
        # Por ahora solo retornamos None
        pass
    except Exception as e:
        print(f"❌ Error con Node.js: {e}")

    return None

def prompt_manual_input():
    """Pide al usuario ingresar los tokens manualmente"""
    print("\n" + "="*60)
    print("📋 INGRESO MANUAL DE TOKENS")
    print("="*60)
    print("""
Para obtener los tokens manualmente:

1. Abre YouTube (https://www.youtube.com) en Chrome/Firefox
2. Abre DevTools (F12) → pestaña Network
3. Filtra por 'v1/player'
4. Reproduce cualquier video
5. En el request 'player', ve a Response
6. Busca 'serviceIntegrityDimensions' → copia 'poToken'
7. Para visitorData: en Console ejecuta: ytcfg.get('VISITOR_DATA')

IMPORTANTE: Hazlo SIN iniciar sesión para mejor resultado
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
    import time

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
    print(f"   PO Token: {'✓ Presente' if data['poToken'] else '✗ No disponible'}")
    print(f"   Visitor Data: {'✓ Presente' if data['visitorData'] else '✗ No disponible'}")
    print(f"   Método: {data['method']}")

def main():
    print("="*60)
    print("🎵 YOUTUBE TOKEN GENERATOR - CYALTRONIC")
    print("="*60)

    # Intentar métodos automáticos primero
    tokens = None

    # Método 1: bgutil directo
    tokens = generate_with_bgutil()

    # Método 2: servidor bgutil
    if not tokens:
        tokens = generate_with_bgutil_server()

    # Método 3: entrada manual
    if not tokens:
        print("\n⚠️ No se pudieron generar tokens automáticamente")
        choice = input("\n¿Deseas ingresar los tokens manualmente? (s/n): ").strip().lower()
        if choice == 's':
            tokens = prompt_manual_input()

    # Guardar tokens si se obtuvieron
    if tokens and (tokens.get("poToken") or tokens.get("visitorData")):
        save_tokens(tokens)
        print("\n🎉 ¡Configuración completada!")
        print("   Reinicia el bot para usar los nuevos tokens")
    else:
        print("\n❌ No se configuraron tokens")
        print("   El bot intentará funcionar sin ellos (puede fallar)")
        print("\nOpciones:")
        print("  1. Instalar bgutil: pip3 install --break-system-packages bgutil")
        print("  2. Correr bgutil server: bgutil-server")
        print("  3. Ingresar tokens manualmente corriendo este script de nuevo")

if __name__ == "__main__":
    main()
