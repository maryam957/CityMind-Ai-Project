from __future__ import annotations

import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DEV_HOST = "127.0.0.1"
DEV_PORT = 5173
DEV_URL = f"http://{DEV_HOST}:{DEV_PORT}"


def _is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) == 0


def _frontend_command() -> list[str]:
    vite_bin = PROJECT_ROOT / "node_modules" / ".bin" / ("vite.cmd" if sys.platform == "win32" else "vite")
    if vite_bin.exists():
        return [str(vite_bin), "--host", DEV_HOST, "--port", str(DEV_PORT)]
    return ["npm", "run", "dev"]


def main() -> None:
    package_json = PROJECT_ROOT / "package.json"
    if not package_json.exists():
        raise SystemExit("React frontend files are missing. Run the JSX scaffold first.")

    command = _frontend_command()
    try:
        process = subprocess.Popen(command, cwd=PROJECT_ROOT)
    except FileNotFoundError as exc:
        raise SystemExit(
            "Unable to start the JSX UI. Install Node.js and run npm install in the citymind folder first."
        ) from exc

    try:
        for _ in range(150):
            if process.poll() is not None:
                raise SystemExit(process.returncode or 1)
            if _is_port_open(DEV_HOST, DEV_PORT):
                break
            time.sleep(0.1)

        webbrowser.open(DEV_URL)
        print(f"CityMind JSX UI is running at {DEV_URL}")
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait()


if __name__ == "__main__":
    main()
