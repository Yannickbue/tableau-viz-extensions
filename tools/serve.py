"""Serve the repo on http://localhost:8765 for Tableau Desktop development.

    python tools/serve.py            # port 8765 (matches trex/local/*.trex)
    python tools/serve.py --port 0   # any free port (used by check.py)

Tableau Desktop accepts http:// only for localhost. Responses are sent with
no-cache headers so an edit shows up after Reload in the extension's menu.
"""
import argparse
import functools
import http.server
import pathlib
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if not getattr(self.server, 'quiet', False):
            super().log_message(fmt, *args)


def start(port=8765, quiet=False):
    """Start the server in a background thread and return it (server.server_port has the port)."""
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    server.quiet = quiet
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    args = ap.parse_args()
    srv = start(args.port)
    print(f'Serving {ROOT} on http://localhost:{srv.server_port}  (Ctrl+C to stop)')
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
